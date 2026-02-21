"""Upload flow for RAG document ingestion."""

from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Mapping, Protocol

ALLOWED_CONTENT_TYPES = frozenset(
    {
        "application/pdf",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    }
)
PPTX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
DOC_CONTENT_TYPE = "application/msword"
MAX_OFFICE_DOC_BYTES = 50 * 1024 * 1024
UPLOAD_URL_EXPIRY_SECONDS = 900
_COURSE_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


class UploadValidationError(ValueError):
    """Raised when upload requests violate API constraints."""


class S3PresignClient(Protocol):
    """Protocol for the boto3 S3 client method used by this module."""

    def generate_presigned_url(
        self,
        ClientMethod: str,  # noqa: N803 - boto3 naming
        Params: Dict[str, str],  # noqa: N803 - boto3 naming
        ExpiresIn: int,  # noqa: N803 - boto3 naming
        HttpMethod: str | None = ...,  # noqa: N803 - boto3 naming
    ) -> str: ...


@dataclass(frozen=True)
class UploadRequest:
    """Validated upload request payload."""

    course_id: str
    filename: str
    content_type: str
    content_length_bytes: int | None = None


def _require_non_empty_string(payload: Mapping[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise UploadValidationError(f"'{field}' must be a non-empty string")
    return value.strip()


def parse_upload_request(payload: Mapping[str, Any]) -> UploadRequest:
    """Validate incoming upload payload."""
    course_id = _require_non_empty_string(payload, "courseId")
    filename = _require_non_empty_string(payload, "filename")
    content_type = _require_non_empty_string(payload, "contentType")
    content_length = payload.get("contentLengthBytes")

    if not _COURSE_ID_PATTERN.match(course_id):
        raise UploadValidationError(
            "'courseId' must contain only letters, numbers, '.', '_' or '-'"
        )

    if content_type not in ALLOWED_CONTENT_TYPES:
        raise UploadValidationError(
            "'contentType' must be one of: application/pdf, text/plain, "
            "application/vnd.openxmlformats-officedocument.presentationml.presentation, "
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document, "
            "application/msword"
        )

    basename = Path(filename).name
    if basename != filename or basename in {"", ".", ".."}:
        raise UploadValidationError("'filename' must be a bare file name")

    if content_type == "application/pdf" and not basename.lower().endswith(".pdf"):
        raise UploadValidationError("'filename' must end with '.pdf' for PDF uploads")
    if content_type == PPTX_CONTENT_TYPE and not basename.lower().endswith(".pptx"):
        raise UploadValidationError("'filename' must end with '.pptx' for PowerPoint uploads")
    if content_type == DOCX_CONTENT_TYPE and not basename.lower().endswith(".docx"):
        raise UploadValidationError("'filename' must end with '.docx' for Word uploads")
    if content_type == DOC_CONTENT_TYPE and not basename.lower().endswith(".doc"):
        raise UploadValidationError("'filename' must end with '.doc' for Word uploads")
    if content_type in {PPTX_CONTENT_TYPE, DOCX_CONTENT_TYPE, DOC_CONTENT_TYPE}:
        if not isinstance(content_length, int) or content_length <= 0:
            raise UploadValidationError(
                "'contentLengthBytes' must be a positive integer for .pptx/.docx/.doc uploads"
            )
        if content_length > MAX_OFFICE_DOC_BYTES:
            extension = (
                ".pptx"
                if content_type == PPTX_CONTENT_TYPE
                else ".docx" if content_type == DOCX_CONTENT_TYPE else ".doc"
            )
            raise UploadValidationError(f"'{extension}' exceeds 50MB limit")

    return UploadRequest(
        course_id=course_id,
        filename=basename,
        content_type=content_type,
        content_length_bytes=content_length if isinstance(content_length, int) else None,
    )


def build_s3_key(upload: UploadRequest, doc_id: str) -> str:
    """Build stable S3 key for uploaded source docs."""
    return f"uploads/{upload.course_id}/{doc_id}/{upload.filename}"


def create_upload(
    payload: Mapping[str, Any],
    *,
    uploads_bucket: str,
    s3_client: S3PresignClient,
    expires_in_seconds: int = UPLOAD_URL_EXPIRY_SECONDS,
    doc_id_factory: Callable[[], str] | None = None,
) -> Dict[str, Any]:
    """Validate request and produce upload metadata + presigned S3 URL."""
    if not uploads_bucket:
        raise ValueError("uploads_bucket is required")

    upload = parse_upload_request(payload)
    generate_doc_id = doc_id_factory or (lambda: f"doc-{uuid.uuid4()}")
    doc_id = generate_doc_id()
    key = build_s3_key(upload, doc_id)

    upload_url = s3_client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": uploads_bucket,
            "Key": key,
            "ContentType": upload.content_type,
        },
        ExpiresIn=expires_in_seconds,
        HttpMethod="PUT",
    )

    return {
        "docId": doc_id,
        "key": key,
        "uploadUrl": upload_url,
        "expiresInSeconds": expires_in_seconds,
        "contentType": upload.content_type,
    }


def _build_json_response(status_code: int, payload: Mapping[str, Any]) -> Dict[str, Any]:
    """Build API Gateway Lambda proxy response."""
    origin = os.getenv("CORS_ALLOW_ORIGIN", "*").strip() or "*"
    methods = os.getenv("CORS_ALLOW_METHODS", "GET,POST,OPTIONS").strip() or "GET,POST,OPTIONS"
    allow_headers = os.getenv(
        "CORS_ALLOW_HEADERS",
        "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
    ).strip() or "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token"
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": methods,
            "Access-Control-Allow-Headers": allow_headers,
        },
        "body": json.dumps(payload),
    }


def _load_json_body(event: Mapping[str, Any]) -> Mapping[str, Any]:
    body = event.get("body")
    if isinstance(body, dict):
        return body
    if isinstance(body, str):
        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise UploadValidationError("request body must be a JSON object")
        return parsed
    raise UploadValidationError("request body must be a JSON object")


def create_default_s3_client() -> S3PresignClient:
    """Create boto3 S3 client lazily to keep test dependencies small."""
    import boto3  # Imported lazily so tests can stub the client without boto3 installed.

    return boto3.client("s3")


def lambda_handler(
    event: Mapping[str, Any],
    _context: Any,
    *,
    s3_client: S3PresignClient | None = None,
) -> Dict[str, Any]:
    """Lambda entrypoint for POST /uploads."""
    uploads_bucket = os.getenv("UPLOADS_BUCKET", "").strip()
    if not uploads_bucket:
        return _build_json_response(500, {"error": "server misconfiguration: UPLOADS_BUCKET missing"})

    client = s3_client or create_default_s3_client()

    try:
        payload = _load_json_body(event)
        response = create_upload(payload, uploads_bucket=uploads_bucket, s3_client=client)
        return _build_json_response(200, response)
    except UploadValidationError as exc:
        return _build_json_response(400, {"error": str(exc)})
    except json.JSONDecodeError:
        return _build_json_response(400, {"error": "request body must be valid JSON"})
