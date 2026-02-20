"""API Gateway Lambda runtime handler for fixture-backed demo routes."""

from __future__ import annotations

import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Mapping

from backend import uploads

_ROOT_DIR = Path(__file__).resolve().parent.parent
_FIXTURES_DIR = _ROOT_DIR / "fixtures"
_DEMO_MODE_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})


@lru_cache(maxsize=1)
def _load_fixtures() -> Dict[str, list[dict[str, Any]]]:
    return {
        "courses": _read_json_fixture("courses.json"),
        "items": _read_json_fixture("canvas_items.json"),
        "cards": _read_json_fixture("cards.json"),
        "topics": _read_json_fixture("topics.json"),
    }


def _read_json_fixture(filename: str) -> list[dict[str, Any]]:
    payload = json.loads((_FIXTURES_DIR / filename).read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"fixture {filename} must be a list")
    return payload


def _is_demo_mode() -> bool:
    raw = os.getenv("DEMO_MODE", "true")
    return raw.strip().lower() in _DEMO_MODE_TRUE_VALUES


def _json_response(status_code: int, payload: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload),
    }


def _text_response(status_code: int, payload: str, *, content_type: str) -> Dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": content_type},
        "body": payload,
    }


def _request_method(event: Mapping[str, Any]) -> str:
    if isinstance(event.get("requestContext"), dict):
        context = event["requestContext"]
        if isinstance(context.get("http"), dict):
            method = context["http"].get("method")
            if isinstance(method, str) and method:
                return method.upper()

    method = event.get("httpMethod", "")
    if isinstance(method, str):
        return method.upper()
    return ""


def _request_path(event: Mapping[str, Any]) -> str:
    raw_path = event.get("rawPath")
    if isinstance(raw_path, str) and raw_path:
        return raw_path

    path = event.get("path")
    if isinstance(path, str) and path:
        return path

    return "/"


def _normalized_path(event: Mapping[str, Any], path: str) -> str:
    """Strip API Gateway stage prefixes (for example '/dev') from request paths."""
    context = event.get("requestContext")
    if not isinstance(context, dict):
        return path

    stage = context.get("stage")
    if not isinstance(stage, str) or not stage.strip():
        return path

    stage_prefix = f"/{stage.strip()}"
    if path == stage_prefix:
        return "/"
    if path.startswith(f"{stage_prefix}/"):
        return path[len(stage_prefix) :]
    return path


def _query_params(event: Mapping[str, Any]) -> dict[str, str]:
    raw = event.get("queryStringParameters")
    if not isinstance(raw, dict):
        return {}

    params: dict[str, str] = {}
    for key, value in raw.items():
        if isinstance(key, str) and isinstance(value, str):
            params[key] = value
    return params


def _path_params(event: Mapping[str, Any]) -> dict[str, str]:
    raw = event.get("pathParameters")
    if not isinstance(raw, dict):
        return {}

    params: dict[str, str] = {}
    for key, value in raw.items():
        if isinstance(key, str) and isinstance(value, str):
            params[key] = value
    return params


def _parse_json_body(event: Mapping[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    body = event.get("body")

    if isinstance(body, dict):
        return body, None

    if not isinstance(body, str):
        return None, "request body must be a JSON object"

    try:
        decoded = json.loads(body)
    except json.JSONDecodeError:
        return None, "request body must be valid JSON"

    if not isinstance(decoded, dict):
        return None, "request body must be a JSON object"

    return decoded, None


def _require_course_id(event: Mapping[str, Any]) -> tuple[str | None, Dict[str, Any] | None]:
    course_id = _query_params(event).get("courseId", "").strip()
    if not course_id:
        return None, _json_response(400, {"error": "courseId query parameter is required"})
    return course_id, None


def _extract_course_id_from_path(path: str, path_params: Mapping[str, str]) -> str | None:
    from_params = path_params.get("courseId", "").strip()
    if from_params:
        return from_params

    match = re.fullmatch(r"/courses/([^/]+)/items", path)
    if not match:
        return None
    return match.group(1)


def _extract_calendar_token(path: str, path_params: Mapping[str, str]) -> str | None:
    for key in ("token", "token_ics"):
        from_params = path_params.get(key, "").strip()
        if from_params:
            if from_params.endswith(".ics"):
                return from_params[: -len(".ics")]
            return from_params

    match = re.fullmatch(r"/calendar/([^/]+)\.ics", path)
    if not match:
        return None
    return match.group(1)


def _extract_principal_id(event: Mapping[str, Any]) -> str | None:
    context = event.get("requestContext")
    if not isinstance(context, dict):
        return None

    authorizer = context.get("authorizer")
    if not isinstance(authorizer, dict):
        return None

    principal_id = authorizer.get("principalId")
    if isinstance(principal_id, str) and principal_id.strip():
        return principal_id.strip()
    return None


def _require_demo_mode() -> Dict[str, Any] | None:
    if _is_demo_mode():
        return None
    return _json_response(503, {"error": "live mode not implemented; set DEMO_MODE=true"})


def _validate_review_payload(payload: Mapping[str, Any]) -> str | None:
    required = ("cardId", "courseId", "rating", "reviewedAt")
    for field in required:
        value = payload.get(field)
        if not isinstance(value, str) and field != "rating":
            return f"{field} is required"
        if field != "rating" and not value.strip():
            return f"{field} is required"

    rating = payload.get("rating")
    if not isinstance(rating, int) or rating < 1 or rating > 5:
        return "rating must be an integer between 1 and 5"

    reviewed_at = payload.get("reviewedAt")
    if not isinstance(reviewed_at, str) or not reviewed_at.strip():
        return "reviewedAt is required"

    try:
        datetime.fromisoformat(reviewed_at.replace("Z", "+00:00"))
    except ValueError:
        return "reviewedAt must be an RFC3339 timestamp"

    return None


def _to_ics_datetime(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _build_ics_payload(*, user_id: str, items: list[dict[str, Any]]) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//GURT//StudyBuddy//EN",
    ]

    for item in items:
        course_id = str(item["courseId"])
        item_id = str(item["id"])
        due_at = str(item["dueAt"])
        title = str(item["title"]).replace("\n", " ").replace("\r", " ")

        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:studybuddy:{user_id}:{course_id}:{item_id}",
                f"DTSTAMP:{_to_ics_datetime(due_at)}",
                f"DTSTART:{_to_ics_datetime(due_at)}",
                f"DTEND:{_to_ics_datetime(due_at)}",
                f"SUMMARY:{title}",
                f"DESCRIPTION:Course {course_id}",
                "END:VEVENT",
            ]
        )

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def _handle_calendar(event: Mapping[str, Any], token: str) -> Dict[str, Any]:
    configured_token = os.getenv("CALENDAR_TOKEN", "").strip()
    if not configured_token:
        return _json_response(500, {"error": "server misconfiguration: CALENDAR_TOKEN missing"})

    if token != configured_token:
        return _json_response(404, {"error": "calendar token not found"})

    expected_user_id = os.getenv("CALENDAR_TOKEN_USER_ID", "").strip()
    principal_id = _extract_principal_id(event)
    if expected_user_id and principal_id and principal_id != expected_user_id:
        return _json_response(403, {"error": "calendar token is not valid for this user"})

    fixtures = _load_fixtures()
    user_id = expected_user_id or principal_id or "demo-user"
    payload = _build_ics_payload(user_id=user_id, items=fixtures["items"])
    return _text_response(200, payload, content_type="text/calendar")


def lambda_handler(event: Mapping[str, Any], context: Any) -> Dict[str, Any]:
    """API Gateway Lambda entrypoint for fixture-backed demo routes."""
    method = _request_method(event)
    path = _normalized_path(event, _request_path(event))
    path_params = _path_params(event)

    if method == "POST" and path == "/uploads":
        return uploads.lambda_handler(event, context)

    if method == "GET" and path == "/health":
        return _json_response(200, {"status": "ok"})

    demo_guard = _require_demo_mode()
    if demo_guard is not None:
        return demo_guard

    if method == "GET" and path == "/courses":
        return _text_response(200, json.dumps(_load_fixtures()["courses"]), content_type="application/json")

    if method == "GET":
        course_id = _extract_course_id_from_path(path, path_params)
        if course_id is not None:
            fixtures = _load_fixtures()
            items = [row for row in fixtures["items"] if row.get("courseId") == course_id]
            return _text_response(200, json.dumps(items), content_type="application/json")

    if method == "GET" and path == "/study/today":
        course_id, error = _require_course_id(event)
        if error is not None:
            return error

        cards = [
            row
            for row in _load_fixtures()["cards"]
            if row.get("courseId") == course_id
        ]
        return _text_response(200, json.dumps(cards[:5]), content_type="application/json")

    if method == "POST" and path == "/study/review":
        payload, error = _parse_json_body(event)
        if error is not None:
            return _json_response(400, {"error": error})

        validation_error = _validate_review_payload(payload)
        if validation_error is not None:
            return _json_response(400, {"accepted": False, "error": validation_error})

        return _json_response(200, {"accepted": True})

    if method == "GET" and path == "/study/mastery":
        course_id, error = _require_course_id(event)
        if error is not None:
            return error

        fixtures = _load_fixtures()
        due_cards_by_topic = Counter(
            str(card["topicId"]) for card in fixtures["cards"] if card.get("courseId") == course_id
        )

        rows = [
            {
                "topicId": topic["id"],
                "courseId": course_id,
                "masteryLevel": topic["masteryLevel"],
                "dueCards": due_cards_by_topic.get(str(topic["id"]), 0),
            }
            for topic in fixtures["topics"]
            if topic.get("courseId") == course_id
        ]
        return _text_response(200, json.dumps(rows), content_type="application/json")

    if method == "GET":
        token = _extract_calendar_token(path, path_params)
        if token is not None:
            return _handle_calendar(event, token)

    return _json_response(404, {"error": "not found"})
