"""Step Functions task handlers for async practice exam generation."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Mapping

logger = logging.getLogger(__name__)


def _utc_now_rfc3339() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _docs_table() -> Any:
    import boto3

    table_name = os.getenv("DOCS_TABLE", "").strip()
    if not table_name:
        raise RuntimeError("server misconfiguration: DOCS_TABLE missing")
    return boto3.resource("dynamodb").Table(table_name)


def worker_handler(event: Mapping[str, Any], _context: Any) -> dict[str, Any]:
    """Generate practice exam questions. Called by Step Functions."""
    payload = dict(event)
    job_id = str(payload.get("jobId", "")).strip()
    course_id = str(payload.get("courseId", "")).strip()
    num_questions = int(payload.get("numQuestions", 10))

    if not course_id:
        return {**payload, "exam": {}, "error": "courseId is required"}

    try:
        from backend.generation import generate_practice_exam

        exam = generate_practice_exam(
            course_id=course_id,
            num_questions=max(1, min(num_questions, 20)),
        )
    except Exception as exc:
        logger.exception("Practice exam generation failed for job %s", job_id)
        return {**payload, "exam": {}, "error": str(exc)}

    return {**payload, "exam": exam, "error": ""}


def finalize_handler(event: Mapping[str, Any], _context: Any) -> dict[str, Any]:
    """Persist results and update job record. Called by Step Functions after worker."""
    payload = dict(event)
    job_id = str(payload.get("jobId", "")).strip()
    error = str(payload.get("error", "")).strip()
    exam = payload.get("exam")
    if not isinstance(exam, dict):
        exam = {}

    status = "FAILED" if error else "FINISHED"
    now = _utc_now_rfc3339()

    _docs_table().update_item(
        Key={"docId": job_id},
        UpdateExpression="SET #s = :status, updatedAt = :now, exam = :exam, #e = :err",
        ExpressionAttributeNames={"#s": "status", "#e": "error"},
        ExpressionAttributeValues={
            ":status": status,
            ":now": now,
            ":exam": exam,
            ":err": error,
        },
    )

    question_count = 0
    if isinstance(exam.get("questions"), list):
        question_count = len(exam["questions"])

    return {
        "jobId": job_id,
        "status": status,
        "questionCount": question_count,
        "updatedAt": now,
        "error": error,
    }
