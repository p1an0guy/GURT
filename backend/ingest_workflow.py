"""Step Functions task handlers for document ingestion with PyMuPDF + Textract fallback."""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Mapping

logger = logging.getLogger(__name__)


def _utc_now_rfc3339() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_event(event: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(event, dict):
        raise ValueError("event must be a JSON object")
    return dict(event)


def _s3_client() -> Any:
    import boto3

    return boto3.client("s3")


def _textract_client() -> Any:
    import boto3

    return boto3.client("textract")


def _dynamodb_table() -> Any:
    import boto3

    table_name = os.getenv("DOCS_TABLE", "").strip()
    if not table_name:
        raise RuntimeError("server misconfiguration: DOCS_TABLE missing")
    return boto3.resource("dynamodb").Table(table_name)


def _bedrock_agent_client() -> Any:
    import boto3

    return boto3.client("bedrock-agent")


def _read_s3_bytes(bucket: str, key: str) -> bytes:
    response = _s3_client().get_object(Bucket=bucket, Key=key)
    return response["Body"].read()


def _extract_text_with_pymupdf(data: bytes, key: str) -> str:
    if not key.lower().endswith(".pdf"):
        try:
            return data.decode("utf-8", errors="ignore")
        except Exception:
            return ""

    try:
        import fitz  # type: ignore
    except Exception:
        return ""

    text_parts: list[str] = []
    with fitz.open(stream=data, filetype="pdf") as document:
        for page in document:
            text_parts.append(page.get_text("text") or "")
    return "\n".join(text_parts).strip()


def _persist_status(
    *,
    job_id: str,
    doc_id: str,
    course_id: str,
    source_key: str,
    status: str,
    text: str = "",
    used_textract: bool = False,
    error: str = "",
) -> None:
    now = _utc_now_rfc3339()
    _dynamodb_table().put_item(
        Item={
            "docId": job_id,
            "entityType": "IngestJob",
            "jobId": job_id,
            "sourceDocId": doc_id,
            "courseId": course_id,
            "sourceKey": source_key,
            "status": status,
            "textLength": len(text),
            "usedTextract": used_textract,
            "updatedAt": now,
            "error": error,
        }
    )


def _persist_kb_ingestion_result(
    job_id: str,
    *,
    ingestion_job_id: str | None = None,
    ingestion_error: str | None = None,
) -> None:
    """Update the ingest job row with KB ingestion job id or error for traceability."""
    table = _dynamodb_table()
    now = _utc_now_rfc3339()
    updates: list[str] = ["kbIngestionUpdatedAt = :now"]
    values: dict[str, Any] = {":now": now}
    if ingestion_job_id is not None:
        updates.append("kbIngestionJobId = :jid")
        values[":jid"] = ingestion_job_id
    if ingestion_error is not None:
        updates.append("kbIngestionError = :err")
        values[":err"] = ingestion_error
    table.update_item(
        Key={"docId": job_id},
        UpdateExpression="SET " + ", ".join(updates),
        ExpressionAttributeValues=values,
    )


def extract_handler(event: Mapping[str, Any], _context: Any) -> dict[str, Any]:
    payload = _parse_event(event)
    bucket = str(payload.get("bucket", "")).strip()
    key = str(payload.get("key", "")).strip()
    threshold = int(payload.get("threshold", 200))
    if not bucket or not key:
        raise ValueError("bucket and key are required")

    data = _read_s3_bytes(bucket, key)
    text = _extract_text_with_pymupdf(data, key)
    return {
        **payload,
        "text": text,
        "textLength": len(text),
        "usedTextract": False,
        "needsTextract": len(text.strip()) < threshold,
    }


def start_textract_handler(event: Mapping[str, Any], _context: Any) -> dict[str, Any]:
    payload = _parse_event(event)
    bucket = str(payload.get("bucket", "")).strip()
    key = str(payload.get("key", "")).strip()
    if not bucket or not key:
        raise ValueError("bucket and key are required")

    response = _textract_client().start_document_text_detection(
        DocumentLocation={"S3Object": {"Bucket": bucket, "Name": key}}
    )
    return {
        **payload,
        "usedTextract": True,
        "textractJobId": response["JobId"],
    }


def poll_textract_handler(event: Mapping[str, Any], _context: Any) -> dict[str, Any]:
    payload = _parse_event(event)
    job_id = str(payload.get("textractJobId", "")).strip()
    if not job_id:
        raise ValueError("textractJobId is required")

    client = _textract_client()
    response = client.get_document_text_detection(JobId=job_id)
    status = str(response.get("JobStatus", "IN_PROGRESS"))
    if status == "IN_PROGRESS":
        return {**payload, "textractStatus": status, "done": False}
    if status != "SUCCEEDED":
        return {
            **payload,
            "textractStatus": status,
            "done": True,
            "error": f"textract job {job_id} ended with status {status}",
        }

    lines: list[str] = []
    next_token = response.get("NextToken")
    for block in response.get("Blocks", []):
        if block.get("BlockType") == "LINE" and isinstance(block.get("Text"), str):
            lines.append(block["Text"])

    while next_token:
        response = client.get_document_text_detection(JobId=job_id, NextToken=next_token)
        for block in response.get("Blocks", []):
            if block.get("BlockType") == "LINE" and isinstance(block.get("Text"), str):
                lines.append(block["Text"])
        next_token = response.get("NextToken")

    text = "\n".join(lines).strip()
    return {
        **payload,
        "text": text,
        "textLength": len(text),
        "textractStatus": "SUCCEEDED",
        "done": True,
    }


def finalize_handler(event: Mapping[str, Any], _context: Any) -> dict[str, Any]:
    payload = _parse_event(event)
    job_id = str(payload.get("jobId", "")).strip()
    doc_id = str(payload.get("docId", "")).strip()
    course_id = str(payload.get("courseId", "")).strip()
    source_key = str(payload.get("key", "")).strip()
    if not all((job_id, doc_id, course_id, source_key)):
        raise ValueError("jobId, docId, courseId, and key are required")

    error = str(payload.get("error", "")).strip()
    text = str(payload.get("text", ""))
    used_textract = bool(payload.get("usedTextract", False))
    status = "FAILED" if error else "FINISHED"

    _persist_status(
        job_id=job_id,
        doc_id=doc_id,
        course_id=course_id,
        source_key=source_key,
        status=status,
        text=text,
        used_textract=used_textract,
        error=error,
    )

    if status == "FINISHED":
        kb_id = os.getenv("KNOWLEDGE_BASE_ID", "").strip()
        ds_id = os.getenv("DATA_SOURCE_ID", "").strip()
        if not kb_id or not ds_id:
            err_msg = "server misconfiguration: KNOWLEDGE_BASE_ID and DATA_SOURCE_ID required for KB ingestion"
            logger.error(err_msg)
            _persist_kb_ingestion_result(job_id, ingestion_error=err_msg)
        else:
            client_token = hashlib.sha256(
                f"{source_key}:{len(text)}".encode()
            ).hexdigest()
            try:
                response = _bedrock_agent_client().start_ingestion_job(
                    knowledgeBaseId=kb_id,
                    dataSourceId=ds_id,
                    clientToken=client_token,
                )
                ingestion_job_id = response["ingestionJob"]["ingestionJobId"]
                logger.info(
                    "KB ingestion started for job %s: ingestionJobId=%s",
                    job_id,
                    ingestion_job_id,
                )
                _persist_kb_ingestion_result(job_id, ingestion_job_id=ingestion_job_id)
            except Exception as exc:  # noqa: BLE001
                err_msg = f"KB ingestion trigger failed: {exc}"
                logger.exception(err_msg)
                _persist_kb_ingestion_result(job_id, ingestion_error=err_msg)

    return {
        "jobId": job_id,
        "status": status,
        "textLength": len(text),
        "usedTextract": used_textract,
        "updatedAt": _utc_now_rfc3339(),
        "error": error,
    }


def _response(status_code: int, payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload),
    }

