"""Step Functions task handlers for async flashcard generation."""

from __future__ import annotations

import json
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


def _cards_table() -> Any:
    import boto3
    table_name = os.getenv("CARDS_TABLE", "").strip()
    if not table_name:
        raise RuntimeError("server misconfiguration: CARDS_TABLE missing")
    return boto3.resource("dynamodb").Table(table_name)


def worker_handler(event: Mapping[str, Any], _context: Any) -> dict[str, Any]:
    """Generate flashcards from materials. Called by Step Functions.

    Input: {jobId, courseId, materialS3Keys, numCards, userId}
    Output: {...input, cards: [...], error: ""}

    Never raises -- catches all exceptions and returns error field so finalize always runs.
    """
    payload = dict(event)
    job_id = str(payload.get("jobId", "")).strip()
    course_id = str(payload.get("courseId", "")).strip()
    material_s3_keys = payload.get("materialS3Keys", [])
    num_cards = int(payload.get("numCards", 20))

    if not course_id or not material_s3_keys:
        return {**payload, "cards": [], "error": "courseId and materialS3Keys are required"}

    try:
        from backend.generation import generate_flashcards_from_materials
        cards = generate_flashcards_from_materials(
            course_id=course_id,
            material_s3_keys=material_s3_keys,
            num_cards=num_cards,
        )
    except Exception as exc:
        logger.exception("Flashcard generation failed for job %s", job_id)
        return {**payload, "cards": [], "error": str(exc)}

    return {**payload, "cards": cards, "error": ""}


def finalize_handler(event: Mapping[str, Any], _context: Any) -> dict[str, Any]:
    """Persist results and update job record. Called by Step Functions after worker.

    Input: output from worker_handler
    Output: {jobId, status, cardCount, updatedAt, error}
    """
    payload = dict(event)
    job_id = str(payload.get("jobId", "")).strip()
    course_id = str(payload.get("courseId", "")).strip()
    error = str(payload.get("error", "")).strip()
    cards = payload.get("cards", [])
    if not isinstance(cards, list):
        cards = []

    status = "FAILED" if error else "FINISHED"
    now = _utc_now_rfc3339()

    # Persist cards to CARDS_TABLE if successful
    card_ids: list[str] = []
    if status == "FINISHED" and cards:
        table = _cards_table()
        for card in cards:
            if not isinstance(card, dict):
                continue
            card_id = str(card.get("id", "")).strip()
            if not card_id:
                continue
            card_ids.append(card_id)
            table.put_item(
                Item={
                    "cardId": card_id,
                    "entityType": "Card",
                    "courseId": str(card.get("courseId", course_id)),
                    "topicId": str(card.get("topicId", "topic-unknown")),
                    "prompt": str(card.get("prompt", "")),
                    "answer": str(card.get("answer", "")),
                    "dueAt": now,
                    "createdAt": now,
                    "updatedAt": now,
                }
            )

    # Update job record in DOCS_TABLE (use update_item to preserve original metadata)
    _docs_table().update_item(
        Key={"docId": job_id},
        UpdateExpression="SET #s = :status, updatedAt = :now, cards = :cards, cardIds = :cids, #e = :err",
        ExpressionAttributeNames={"#s": "status", "#e": "error"},
        ExpressionAttributeValues={
            ":status": status,
            ":now": now,
            ":cards": cards,
            ":cids": card_ids,
            ":err": error,
        },
    )

    return {
        "jobId": job_id,
        "status": status,
        "cardCount": len(card_ids),
        "updatedAt": now,
        "error": error,
    }
