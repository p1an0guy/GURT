"""API Gateway Lambda runtime handler for fixture-backed demo routes."""

from __future__ import annotations

import json
import os
import re
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from uuid import uuid4
from typing import Any, Dict, Mapping

from backend.canvas_client import CanvasApiError, fetch_active_courses, fetch_course_assignments
from backend import uploads
from gurt.calendar_tokens.minting import (
    CalendarTokenMintingError,
    MintingConfig,
    mint_calendar_token,
)
from gurt.calendar_tokens.repository import DynamoDbCalendarTokenStore
from studybuddy.models.canvas import CanvasItem, Course, ModelValidationError

_ROOT_DIR = Path(__file__).resolve().parent.parent
_FIXTURES_DIR = _ROOT_DIR / "fixtures"
_DEMO_MODE_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
_ENTITY_CANVAS_ITEM = "CanvasItem"
_ENTITY_CANVAS_CONNECTION = "CanvasConnection"
_ENTITY_INGEST_JOB = "IngestJob"


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


def _calendar_fixture_fallback_enabled() -> bool:
    raw = os.getenv("CALENDAR_FIXTURE_FALLBACK", "false")
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


def _is_scheduled_event(event: Mapping[str, Any]) -> bool:
    source = event.get("source")
    detail_type = event.get("detail-type")
    return source == "aws.events" and detail_type == "Scheduled Event"


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


def _headers(event: Mapping[str, Any]) -> dict[str, str]:
    raw = event.get("headers")
    if not isinstance(raw, dict):
        return {}

    normalized: dict[str, str] = {}
    for key, value in raw.items():
        if isinstance(key, str) and isinstance(value, str):
            normalized[key.lower()] = value
    return normalized


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


def _require_non_empty_string(payload: Mapping[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")
    return value.strip()


def _utc_now_rfc3339() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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


def _extract_authenticated_user_id(event: Mapping[str, Any]) -> str | None:
    context = event.get("requestContext")
    if not isinstance(context, dict):
        return None

    authorizer = context.get("authorizer")
    if isinstance(authorizer, dict):
        principal_id = authorizer.get("principalId")
        if isinstance(principal_id, str) and principal_id.strip():
            return principal_id.strip()

        claims = authorizer.get("claims")
        if isinstance(claims, dict):
            sub = claims.get("sub")
            if isinstance(sub, str) and sub.strip():
                return sub.strip()

        jwt = authorizer.get("jwt")
        if isinstance(jwt, dict):
            jwt_claims = jwt.get("claims")
            if isinstance(jwt_claims, dict):
                sub = jwt_claims.get("sub")
                if isinstance(sub, str) and sub.strip():
                    return sub.strip()

    identity = context.get("identity")
    if isinstance(identity, dict):
        user_arn = identity.get("userArn")
        if isinstance(user_arn, str) and user_arn.strip():
            return user_arn.strip()
    return None


def _require_authenticated_user_id(event: Mapping[str, Any]) -> tuple[str | None, Dict[str, Any] | None]:
    user_id = _extract_authenticated_user_id(event)
    if user_id is None:
        if _is_demo_mode():
            fallback = os.getenv("DEMO_USER_ID", "demo-user").strip() or "demo-user"
            return fallback, None
        return None, _json_response(401, {"error": "authenticated principal is required"})
    return user_id, None


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


def _dynamodb_table(table_name: str) -> Any:
    import boto3

    return boto3.resource("dynamodb").Table(table_name)


def _stepfunctions_client() -> Any:
    import boto3

    return boto3.client("stepfunctions")


def _calendar_token_store() -> DynamoDbCalendarTokenStore:
    table_name = os.getenv("CALENDAR_TOKENS_TABLE", "").strip()
    if not table_name:
        raise RuntimeError("server misconfiguration: CALENDAR_TOKENS_TABLE missing")
    return DynamoDbCalendarTokenStore(_dynamodb_table(table_name))


def _canvas_data_table() -> Any:
    table_name = os.getenv("CANVAS_DATA_TABLE", "").strip()
    if not table_name:
        raise RuntimeError("server misconfiguration: CANVAS_DATA_TABLE missing")
    return _dynamodb_table(table_name)


def _docs_table() -> Any:
    table_name = os.getenv("DOCS_TABLE", "").strip()
    if not table_name:
        raise RuntimeError("server misconfiguration: DOCS_TABLE missing")
    return _dynamodb_table(table_name)


def _canvas_connection_keys(user_id: str) -> tuple[str, str]:
    return f"USER#{user_id}", "CANVAS_CONNECTION#default"


def _read_canvas_connection(user_id: str) -> dict[str, Any] | None:
    table = _canvas_data_table()
    pk, sk = _canvas_connection_keys(user_id)
    response = table.get_item(Key={"pk": pk, "sk": sk})
    item = response.get("Item")
    if not isinstance(item, dict):
        return None
    if item.get("entityType") != _ENTITY_CANVAS_CONNECTION:
        return None
    return item


def _list_canvas_connections() -> list[dict[str, str]]:
    table = _canvas_data_table()
    response = table.scan()
    rows = list(response.get("Items", []))

    while "LastEvaluatedKey" in response:
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
        rows.extend(response.get("Items", []))

    connections: list[dict[str, str]] = []
    for row in rows:
        if row.get("entityType") != _ENTITY_CANVAS_CONNECTION:
            continue
        user_id = row.get("userId")
        canvas_base_url = row.get("canvasBaseUrl")
        access_token = row.get("accessToken")
        if not (
            isinstance(user_id, str)
            and user_id
            and isinstance(canvas_base_url, str)
            and canvas_base_url
            and isinstance(access_token, str)
            and access_token
        ):
            continue
        connections.append(
            {
                "userId": user_id,
                "canvasBaseUrl": canvas_base_url,
                "accessToken": access_token,
            }
        )

    return connections


def _upsert_canvas_connection(*, user_id: str, canvas_base_url: str, access_token: str, updated_at: str) -> None:
    table = _canvas_data_table()
    pk, sk = _canvas_connection_keys(user_id)
    table.put_item(
        Item={
            "pk": pk,
            "sk": sk,
            "entityType": _ENTITY_CANVAS_CONNECTION,
            "userId": user_id,
            "canvasBaseUrl": canvas_base_url,
            "accessToken": access_token,
            "updatedAt": updated_at,
        }
    )


def _ingest_state_machine_arn() -> str:
    arn = os.getenv("INGEST_STATE_MACHINE_ARN", "").strip()
    if not arn:
        raise RuntimeError("server misconfiguration: INGEST_STATE_MACHINE_ARN missing")
    return arn


def _start_ingest_job(*, doc_id: str, course_id: str, key: str) -> dict[str, Any]:
    job_id = f"ingest-{uuid4().hex}"
    bucket = os.getenv("UPLOADS_BUCKET", "").strip()
    if not bucket:
        raise RuntimeError("server misconfiguration: UPLOADS_BUCKET missing")

    now = _utc_now_rfc3339()
    _docs_table().put_item(
        Item={
            "docId": job_id,
            "entityType": _ENTITY_INGEST_JOB,
            "jobId": job_id,
            "sourceDocId": doc_id,
            "courseId": course_id,
            "sourceKey": key,
            "status": "RUNNING",
            "textLength": 0,
            "usedTextract": False,
            "updatedAt": now,
            "error": "",
        }
    )

    execution_input = {
        "jobId": job_id,
        "docId": doc_id,
        "courseId": course_id,
        "bucket": bucket,
        "key": key,
        "threshold": 200,
    }
    _stepfunctions_client().start_execution(
        stateMachineArn=_ingest_state_machine_arn(),
        name=job_id,
        input=json.dumps(execution_input),
    )
    return {
        "jobId": job_id,
        "status": "RUNNING",
        "updatedAt": now,
    }


def _get_ingest_job(job_id: str) -> dict[str, Any] | None:
    response = _docs_table().get_item(Key={"docId": job_id})
    item = response.get("Item")
    if not isinstance(item, dict):
        return None
    if item.get("entityType") != _ENTITY_INGEST_JOB:
        return None
    return item


def _sync_canvas_assignments_for_user(
    *,
    user_id: str,
    canvas_base_url: str,
    access_token: str,
    updated_at: str,
) -> tuple[int, int, list[str]]:
    table = _canvas_data_table()
    user_agent = os.getenv("CANVAS_USER_AGENT", "GURT-DemoCanvasSync/0.1")

    course_payloads = fetch_active_courses(
        base_url=canvas_base_url,
        token=access_token,
        user_agent=user_agent,
    )
    courses = [Course.from_api_dict(row) for row in course_payloads]
    with table.batch_writer(overwrite_by_pkeys=["pk", "sk"]) as batch:
        for course in courses:
            batch.put_item(Item=course.to_dynamodb_item(user_id=user_id, updated_at=updated_at))

    failed_course_ids: list[str] = []
    items_upserted = 0
    with table.batch_writer(overwrite_by_pkeys=["pk", "sk"]) as batch:
        for course in courses:
            try:
                item_payloads = fetch_course_assignments(
                    base_url=canvas_base_url,
                    token=access_token,
                    course_id=course.id,
                    user_agent=user_agent,
                )
            except CanvasApiError:
                failed_course_ids.append(course.id)
                continue

            for payload in item_payloads:
                item = CanvasItem.from_api_dict(payload)
                batch.put_item(Item=item.to_dynamodb_item(user_id=user_id, updated_at=updated_at))
                items_upserted += 1

    return len(courses), items_upserted, failed_course_ids


def _handle_canvas_connect(event: Mapping[str, Any]) -> Dict[str, Any]:
    user_id, auth_error = _require_authenticated_user_id(event)
    if auth_error is not None or user_id is None:
        return auth_error or _json_response(401, {"error": "authenticated principal is required"})

    payload, parse_error = _parse_json_body(event)
    if parse_error is not None or payload is None:
        return _json_response(400, {"error": parse_error or "request body must be valid JSON"})

    canvas_base_url = str(payload.get("canvasBaseUrl", "")).strip()
    access_token = str(payload.get("accessToken", "")).strip()
    if not canvas_base_url.startswith(("https://", "http://")):
        return _json_response(400, {"error": "canvasBaseUrl must start with https:// or http://"})
    if not access_token:
        return _json_response(400, {"error": "accessToken is required"})

    updated_at = _utc_now_rfc3339()
    try:
        _upsert_canvas_connection(
            user_id=user_id,
            canvas_base_url=canvas_base_url,
            access_token=access_token,
            updated_at=updated_at,
        )
    except RuntimeError as exc:
        return _json_response(500, {"error": str(exc)})

    return _json_response(200, {"connected": True, "updatedAt": updated_at})


def _handle_canvas_sync(event: Mapping[str, Any]) -> Dict[str, Any]:
    user_id, auth_error = _require_authenticated_user_id(event)
    if auth_error is not None or user_id is None:
        return auth_error or _json_response(401, {"error": "authenticated principal is required"})

    try:
        connection = _read_canvas_connection(user_id)
        if connection is None:
            return _json_response(400, {"error": "canvas connection not found; call POST /canvas/connect first"})

        updated_at = _utc_now_rfc3339()
        courses_upserted, items_upserted, failed_course_ids = _sync_canvas_assignments_for_user(
            user_id=user_id,
            canvas_base_url=str(connection.get("canvasBaseUrl", "")),
            access_token=str(connection.get("accessToken", "")),
            updated_at=updated_at,
        )
    except CanvasApiError as exc:
        return _json_response(502, {"error": str(exc)})
    except RuntimeError as exc:
        return _json_response(500, {"error": str(exc)})
    except ModelValidationError as exc:
        return _json_response(500, {"error": f"canvas normalization failed: {exc}"})

    return _json_response(
        200,
        {
            "synced": True,
            "coursesUpserted": courses_upserted,
            "itemsUpserted": items_upserted,
            "failedCourseIds": failed_course_ids,
            "updatedAt": updated_at,
        },
    )


def _handle_docs_ingest_start(event: Mapping[str, Any]) -> Dict[str, Any]:
    payload, parse_error = _parse_json_body(event)
    if parse_error is not None or payload is None:
        return _json_response(400, {"error": parse_error or "request body must be valid JSON"})

    try:
        doc_id = _require_non_empty_string(payload, "docId")
        course_id = _require_non_empty_string(payload, "courseId")
        key = _require_non_empty_string(payload, "key")
        job = _start_ingest_job(doc_id=doc_id, course_id=course_id, key=key)
    except ValueError as exc:
        return _json_response(400, {"error": str(exc)})
    except RuntimeError as exc:
        return _json_response(500, {"error": str(exc)})
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return _json_response(500, {"error": f"unable to start ingest job: {exc}"})

    return _json_response(202, job)


def _handle_docs_ingest_status(job_id: str) -> Dict[str, Any]:
    try:
        record = _get_ingest_job(job_id)
    except RuntimeError as exc:
        return _json_response(500, {"error": str(exc)})
    if record is None:
        return _json_response(404, {"error": "ingest job not found"})

    return _json_response(
        200,
        {
            "jobId": str(record.get("jobId", job_id)),
            "status": str(record.get("status", "UNKNOWN")),
            "textLength": int(record.get("textLength", 0)),
            "usedTextract": bool(record.get("usedTextract", False)),
            "updatedAt": str(record.get("updatedAt", "")),
            "error": str(record.get("error", "")),
        },
    )


def _handle_scheduled_canvas_sync() -> Dict[str, Any]:
    updated_at = _utc_now_rfc3339()
    try:
        connections = _list_canvas_connections()
    except RuntimeError as exc:
        return _json_response(500, {"error": str(exc)})

    users_succeeded = 0
    users_failed = 0
    courses_total = 0
    items_total = 0
    failed_course_ids_by_user: dict[str, list[str]] = {}
    user_errors: dict[str, str] = {}

    for connection in connections:
        user_id = connection["userId"]
        try:
            courses_upserted, items_upserted, failed_course_ids = _sync_canvas_assignments_for_user(
                user_id=user_id,
                canvas_base_url=connection["canvasBaseUrl"],
                access_token=connection["accessToken"],
                updated_at=updated_at,
            )
            users_succeeded += 1
            courses_total += courses_upserted
            items_total += items_upserted
            if failed_course_ids:
                failed_course_ids_by_user[user_id] = failed_course_ids
        except (CanvasApiError, ModelValidationError, RuntimeError) as exc:
            users_failed += 1
            user_errors[user_id] = str(exc)

    return _json_response(
        200,
        {
            "scheduled": True,
            "connectionsProcessed": len(connections),
            "usersSucceeded": users_succeeded,
            "usersFailed": users_failed,
            "coursesUpserted": courses_total,
            "itemsUpserted": items_total,
            "failedCourseIdsByUser": failed_course_ids_by_user,
            "userErrors": user_errors,
            "updatedAt": updated_at,
        },
    )


def _scan_canvas_items_for_user(user_id: str) -> list[dict[str, Any]]:
    table_name = os.getenv("CANVAS_DATA_TABLE", "").strip()
    if not table_name:
        return []

    table = _dynamodb_table(table_name)
    from boto3.dynamodb.conditions import Key

    def _query_partition_rows(pk_value: str, sk_prefix: str) -> list[dict[str, Any]]:
        key_condition = Key("pk").eq(pk_value) & Key("sk").begins_with(sk_prefix)
        response = table.query(KeyConditionExpression=key_condition)
        rows = list(response.get("Items", []))

        while "LastEvaluatedKey" in response:
            response = table.query(
                KeyConditionExpression=key_condition,
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
            rows.extend(response.get("Items", []))

        return rows

    user_pk = f"USER#{user_id}"
    course_rows = _query_partition_rows(user_pk, "COURSE#")
    course_ids = [
        str(row.get("id"))
        for row in course_rows
        if row.get("entityType") == "CanvasCourse" and isinstance(row.get("id"), str) and str(row.get("id"))
    ]

    items: list[dict[str, Any]] = []
    for course_id in course_ids:
        item_pk = f"USER#{user_id}#COURSE#{course_id}"
        item_rows = _query_partition_rows(item_pk, "ITEM#")

        for row in item_rows:
            if row.get("entityType") != _ENTITY_CANVAS_ITEM:
                continue
            if row.get("userId") != user_id:
                continue

            item_id = row.get("id")
            title = row.get("title")
            due_at = row.get("dueAt")
            if not all(isinstance(value, str) and value for value in (item_id, title, due_at)):
                continue

            items.append(
                {
                    "id": item_id,
                    "courseId": course_id,
                    "title": title,
                    "dueAt": due_at,
                }
            )

    items.sort(key=lambda row: str(row.get("dueAt", "")))
    return items


def _load_schedule_items_for_user(user_id: str) -> list[dict[str, Any]]:
    items = _scan_canvas_items_for_user(user_id)
    if items:
        return items

    if not (_is_demo_mode() and _calendar_fixture_fallback_enabled()):
        return []

    fixtures = _load_fixtures()
    return [
        {
            "id": str(row["id"]),
            "courseId": str(row["courseId"]),
            "title": str(row["title"]),
            "dueAt": str(row["dueAt"]),
        }
        for row in fixtures["items"]
    ]


def _public_base_url(event: Mapping[str, Any]) -> str:
    configured = os.getenv("PUBLIC_BASE_URL", "").strip()
    if configured:
        return configured.rstrip("/")

    headers = _headers(event)
    host = headers.get("host", "").strip()
    if not host:
        return ""

    scheme = headers.get("x-forwarded-proto", "https").strip() or "https"
    stage = ""
    context = event.get("requestContext")
    if isinstance(context, dict):
        stage_raw = context.get("stage")
        if isinstance(stage_raw, str) and stage_raw.strip():
            stage = f"/{stage_raw.strip()}"

    return f"{scheme}://{host}{stage}"


def _handle_calendar_token_create(event: Mapping[str, Any]) -> Dict[str, Any]:
    user_id, auth_error = _require_authenticated_user_id(event)
    if auth_error is not None or user_id is None:
        return auth_error or _json_response(401, {"error": "authenticated principal is required"})

    try:
        store = _calendar_token_store()
        record = mint_calendar_token(
            user_id=user_id,
            store=store,
            config=MintingConfig.from_env(),
        )
    except CalendarTokenMintingError as exc:
        return _json_response(400, {"error": str(exc)})
    except RuntimeError as exc:
        return _json_response(500, {"error": str(exc)})
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return _json_response(500, {"error": f"unable to mint calendar token: {exc}"})

    base_url = _public_base_url(event)
    feed_url = f"{base_url}/calendar/{record.token}.ics" if base_url else f"/calendar/{record.token}.ics"
    return _json_response(
        201,
        {
            "token": record.token,
            "feedUrl": feed_url,
            "createdAt": record.created_at,
        },
    )


def _handle_calendar(token: str) -> Dict[str, Any]:
    try:
        store = _calendar_token_store()
    except RuntimeError as exc:
        return _json_response(500, {"error": str(exc)})
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        return _json_response(500, {"error": f"unable to read calendar token store: {exc}"})

    record = store.get(token)
    if record is None or record.revoked:
        return _json_response(404, {"error": "calendar token not found"})

    items = _load_schedule_items_for_user(record.user_id)
    payload = _build_ics_payload(user_id=record.user_id, items=items)
    return _text_response(200, payload, content_type="text/calendar")


def lambda_handler(event: Mapping[str, Any], context: Any) -> Dict[str, Any]:
    """API Gateway Lambda entrypoint for fixture-backed demo routes."""
    if _is_scheduled_event(event):
        return _handle_scheduled_canvas_sync()

    method = _request_method(event)
    path = _normalized_path(event, _request_path(event))
    path_params = _path_params(event)

    if method == "POST" and path == "/uploads":
        return uploads.lambda_handler(event, context)

    if method == "GET" and path == "/health":
        return _json_response(200, {"status": "ok"})

    if method == "POST" and path == "/calendar/token":
        return _handle_calendar_token_create(event)

    if method == "POST" and path == "/docs/ingest":
        return _handle_docs_ingest_start(event)

    if method == "GET":
        match = re.fullmatch(r"/docs/ingest/([^/]+)", path)
        if match:
            return _handle_docs_ingest_status(match.group(1))

    if method == "POST" and path == "/canvas/connect":
        return _handle_canvas_connect(event)

    if method == "POST" and path == "/canvas/sync":
        return _handle_canvas_sync(event)

    if method == "GET":
        token = _extract_calendar_token(path, path_params)
        if token is not None:
            return _handle_calendar(token)

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

    return _json_response(404, {"error": "not found"})
