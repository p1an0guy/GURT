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

from backend.canvas_client import (
    CanvasApiError,
    fetch_active_courses,
    fetch_course_assignments,
    fetch_course_files,
    fetch_file_bytes,
)
from backend.generation import GenerationError, chat_answer, generate_flashcards, generate_practice_exam
from backend import uploads
from gurt.calendar_tokens.minting import (
    CalendarTokenMintingError,
    MintingConfig,
    mint_calendar_token,
)
from gurt.calendar_tokens.repository import DynamoDbCalendarTokenStore
from study.fsrs import schedule_review
from studybuddy.models.canvas import CanvasItem, CanvasMaterial, Course, ModelValidationError

_ROOT_DIR = Path(__file__).resolve().parent.parent
_FIXTURES_DIR = _ROOT_DIR / "fixtures"
_DEMO_MODE_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
_ENTITY_CANVAS_ITEM = "CanvasItem"
_ENTITY_CANVAS_CONNECTION = "CanvasConnection"
_ENTITY_INGEST_JOB = "IngestJob"
_MATERIAL_FILENAME_SANITIZE = re.compile(r"[^A-Za-z0-9._-]+")


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


def _s3_client() -> Any:
    import boto3

    return boto3.client("s3")


def _bedrock_agent_client() -> Any:
    import boto3

    return boto3.client("bedrock-agent")


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


def _cards_table() -> Any | None:
    table_name = os.getenv("CARDS_TABLE", "").strip()
    if not table_name:
        return None
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


def _int_env(name: str, default_value: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default_value
    try:
        parsed = int(raw)
    except ValueError:
        return default_value
    return parsed if parsed > 0 else default_value


def _safe_material_filename(name: str) -> str:
    cleaned = _MATERIAL_FILENAME_SANITIZE.sub("_", name.strip())
    cleaned = cleaned.strip("._")
    return cleaned or "material"


def _material_s3_key(*, user_id: str, course_id: str, canvas_file_id: str, display_name: str) -> str:
    safe_name = _safe_material_filename(display_name)
    return f"uploads/canvas-materials/{user_id}/{course_id}/{canvas_file_id}/{safe_name}"


def _start_knowledge_base_ingestion() -> tuple[bool, str, str]:
    knowledge_base_id = os.getenv("KNOWLEDGE_BASE_ID", "").strip()
    data_source_id = os.getenv("KNOWLEDGE_BASE_DATA_SOURCE_ID", "").strip()
    if not knowledge_base_id or not data_source_id:
        missing_vars: list[str] = []
        if not knowledge_base_id:
            missing_vars.append("KNOWLEDGE_BASE_ID")
        if not data_source_id:
            missing_vars.append("KNOWLEDGE_BASE_DATA_SOURCE_ID")
        error_message = f"missing required env var(s): {', '.join(missing_vars)}"
        print(
            "KB ingestion skipped: missing configuration",
            {
                "hasKnowledgeBaseId": bool(knowledge_base_id),
                "hasDataSourceId": bool(data_source_id),
                "error": error_message,
            },
        )
        return False, "", error_message

    try:
        response = _bedrock_agent_client().start_ingestion_job(
            knowledgeBaseId=knowledge_base_id,
            dataSourceId=data_source_id,
            clientToken=str(uuid4()),
        )
    except Exception as exc:
        error_message = str(exc)
        print(
            "KB ingestion start failed",
            {
                "knowledgeBaseId": knowledge_base_id,
                "dataSourceId": data_source_id,
                "error": error_message,
            },
        )
        return False, "", error_message
    ingestion_job = response.get("ingestionJob")
    if not isinstance(ingestion_job, dict):
        return True, "", ""

    job_id = ingestion_job.get("ingestionJobId")
    if isinstance(job_id, str):
        return True, job_id, ""
    return True, "", ""


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


def _sync_canvas_materials_for_user(
    *,
    user_id: str,
    canvas_base_url: str,
    access_token: str,
    updated_at: str,
) -> tuple[int, int, list[str]]:
    table = _canvas_data_table()
    user_agent = os.getenv("CANVAS_USER_AGENT", "GURT-DemoCanvasSync/0.1")
    uploads_bucket = os.getenv("UPLOADS_BUCKET", "").strip()
    if not uploads_bucket:
        raise RuntimeError("server misconfiguration: UPLOADS_BUCKET missing")

    max_material_bytes = _int_env("CANVAS_MAX_FILE_BYTES", 20_000_000)
    max_files_per_course = _int_env("CANVAS_MAX_FILES_PER_COURSE", 5)
    max_files_total = _int_env("CANVAS_MAX_FILES_TOTAL", 20)
    allowed_types_raw = os.getenv("CANVAS_ALLOWED_MATERIAL_CONTENT_TYPES", "application/pdf,text/plain")
    allowed_types = {
        part.strip().lower()
        for part in allowed_types_raw.split(",")
        if part.strip()
    }
    s3_client = _s3_client()

    course_payloads = fetch_active_courses(
        base_url=canvas_base_url,
        token=access_token,
        user_agent=user_agent,
    )
    courses = [Course.from_api_dict(row) for row in course_payloads]
    failed_course_ids: list[str] = []
    failed_course_set: set[str] = set()
    materials_upserted = 0
    materials_mirrored = 0

    with table.batch_writer(overwrite_by_pkeys=["pk", "sk"]) as batch:
        for course in courses:
            if max_files_total > 0 and materials_upserted >= max_files_total:
                break
            try:
                file_payloads = fetch_course_files(
                    base_url=canvas_base_url,
                    token=access_token,
                    course_id=course.id,
                    user_agent=user_agent,
                )
            except CanvasApiError:
                print(
                    "Canvas materials course fetch failed",
                    {"courseId": course.id},
                )
                failed_course_ids.append(course.id)
                failed_course_set.add(course.id)
                continue

            if max_files_per_course > 0:
                file_payloads = file_payloads[:max_files_per_course]

            for payload in file_payloads:
                if max_files_total > 0 and materials_upserted >= max_files_total:
                    break
                try:
                    material_key = _material_s3_key(
                        user_id=user_id,
                        course_id=course.id,
                        canvas_file_id=str(payload.get("canvasFileId", "")),
                        display_name=str(payload.get("displayName", "")),
                    )
                    payload_with_s3_key = dict(payload)
                    payload_with_s3_key["s3Key"] = material_key
                    material = CanvasMaterial.from_api_dict(payload_with_s3_key)

                    if material.size_bytes > max_material_bytes:
                        continue
                    if allowed_types and material.content_type not in allowed_types:
                        if not material.display_name.lower().endswith(".pdf"):
                            continue

                    file_body, downloaded_content_type = fetch_file_bytes(
                        url=material.download_url,
                        token=access_token,
                        user_agent=user_agent,
                    )
                    if len(file_body) > max_material_bytes:
                        continue

                    put_args: dict[str, Any] = {
                        "Bucket": uploads_bucket,
                        "Key": material.s3_key,
                        "Body": file_body,
                        "Metadata": {
                            "source": "canvas",
                            "userid": user_id,
                            "courseid": course.id,
                            "canvasfileid": material.canvas_file_id,
                        },
                    }
                    content_type = downloaded_content_type or material.content_type
                    if content_type:
                        put_args["ContentType"] = content_type

                    s3_client.put_object(**put_args)
                    batch.put_item(Item=material.to_dynamodb_item(user_id=user_id, updated_at=updated_at))
                    materials_upserted += 1
                    materials_mirrored += 1
                except Exception as exc:
                    print(
                        "Canvas material mirror failed",
                        {
                            "courseId": course.id,
                            "canvasFileId": str(payload.get("canvasFileId", "")),
                            "displayName": str(payload.get("displayName", "")),
                            "error": str(exc),
                        },
                    )
                    if course.id not in failed_course_set:
                        failed_course_ids.append(course.id)
                        failed_course_set.add(course.id)
                    continue

    print(
        "Canvas materials sync summary",
        {
            "coursesDiscovered": len(courses),
            "materialsUpserted": materials_upserted,
            "materialsMirrored": materials_mirrored,
            "failedCourseIds": failed_course_ids,
        },
    )
    return materials_upserted, materials_mirrored, failed_course_ids


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
        courses_upserted, items_upserted, failed_assignment_course_ids = _sync_canvas_assignments_for_user(
            user_id=user_id,
            canvas_base_url=str(connection.get("canvasBaseUrl", "")),
            access_token=str(connection.get("accessToken", "")),
            updated_at=updated_at,
        )
        materials_upserted, materials_mirrored, failed_material_course_ids = _sync_canvas_materials_for_user(
            user_id=user_id,
            canvas_base_url=str(connection.get("canvasBaseUrl", "")),
            access_token=str(connection.get("accessToken", "")),
            updated_at=updated_at,
        )

        failed_course_ids = sorted(
            set(failed_assignment_course_ids).union(failed_material_course_ids),
            key=lambda value: str(value),
        )
        kb_ingestion_started = False
        kb_ingestion_job_id = ""
        kb_ingestion_error = ""
        if materials_mirrored > 0:
            kb_ingestion_started, kb_ingestion_job_id, kb_ingestion_error = _start_knowledge_base_ingestion()
    except CanvasApiError as exc:
        return _json_response(502, {"error": str(exc)})
    except RuntimeError as exc:
        return _json_response(500, {"error": str(exc)})
    except ModelValidationError as exc:
        return _json_response(500, {"error": f"canvas normalization failed: {exc}"})
    except Exception as exc:
        return _json_response(500, {"error": f"canvas sync unexpected failure: {exc}"})

    return _json_response(
        200,
        {
            "synced": True,
            "coursesUpserted": courses_upserted,
            "itemsUpserted": items_upserted,
            "materialsUpserted": materials_upserted,
            "materialsMirrored": materials_mirrored,
            "knowledgeBaseIngestionStarted": kb_ingestion_started,
            "knowledgeBaseIngestionJobId": kb_ingestion_job_id,
            "knowledgeBaseIngestionError": kb_ingestion_error,
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

    payload: dict[str, Any] = {
        "jobId": str(record.get("jobId", job_id)),
        "status": str(record.get("status", "UNKNOWN")),
        "textLength": int(record.get("textLength", 0)),
        "usedTextract": bool(record.get("usedTextract", False)),
        "updatedAt": str(record.get("updatedAt", "")),
        "error": str(record.get("error", "")),
    }
    if record.get("kbIngestionJobId"):
        payload["kbIngestionJobId"] = str(record["kbIngestionJobId"])
    if record.get("kbIngestionError"):
        payload["kbIngestionError"] = str(record["kbIngestionError"])
    return _json_response(200, payload)


def _handle_generate_flashcards(event: Mapping[str, Any]) -> Dict[str, Any]:
    payload, parse_error = _parse_json_body(event)
    if parse_error is not None or payload is None:
        return _json_response(400, {"error": parse_error or "request body must be valid JSON"})
    try:
        course_id = _require_non_empty_string(payload, "courseId")
        num_cards_raw = payload.get("numCards", 20)
        num_cards = int(num_cards_raw)
        if num_cards < 1:
            return _json_response(400, {"error": "numCards must be >= 1"})
        cards = generate_flashcards(course_id=course_id, num_cards=min(num_cards, 100))
        _persist_generated_cards(cards)
    except ValueError as exc:
        return _json_response(400, {"error": str(exc)})
    except GenerationError as exc:
        return _json_response(502, {"error": str(exc)})
    except RuntimeError as exc:
        return _json_response(502, {"error": str(exc)})

    return _text_response(200, json.dumps(cards), content_type="application/json")


def _handle_generate_practice_exam(event: Mapping[str, Any]) -> Dict[str, Any]:
    payload, parse_error = _parse_json_body(event)
    if parse_error is not None or payload is None:
        return _json_response(400, {"error": parse_error or "request body must be valid JSON"})
    try:
        course_id = _require_non_empty_string(payload, "courseId")
        num_questions_raw = payload.get("numQuestions", 10)
        num_questions = int(num_questions_raw)
        if num_questions < 1:
            return _json_response(400, {"error": "numQuestions must be >= 1"})
        exam = generate_practice_exam(course_id=course_id, num_questions=min(num_questions, 20))
    except ValueError as exc:
        return _json_response(400, {"error": str(exc)})
    except GenerationError as exc:
        return _json_response(502, {"error": str(exc)})
    except RuntimeError as exc:
        return _json_response(502, {"error": str(exc)})

    return _text_response(200, json.dumps(exam), content_type="application/json")


def _handle_chat(event: Mapping[str, Any]) -> Dict[str, Any]:
    payload, parse_error = _parse_json_body(event)
    if parse_error is not None or payload is None:
        return _json_response(400, {"error": parse_error or "request body must be valid JSON"})
    try:
        course_id = _require_non_empty_string(payload, "courseId")
        question = _require_non_empty_string(payload, "question")
        answer = chat_answer(course_id=course_id, question=question)
    except ValueError as exc:
        return _json_response(400, {"error": str(exc)})
    except GenerationError as exc:
        return _json_response(502, {"error": str(exc)})
    except RuntimeError as exc:
        return _json_response(502, {"error": str(exc)})

    return _text_response(200, json.dumps(answer), content_type="application/json")


def _safe_timestamp_for_sort(value: str) -> str:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    except ValueError:
        return "9999-12-31T23:59:59+00:00"


def _is_due_timestamp(value: str, now: datetime) -> bool:
    try:
        due = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return True
    return due <= now


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _card_row_to_response(row: Mapping[str, Any]) -> dict[str, str] | None:
    card_id = row.get("cardId")
    course_id = row.get("courseId")
    topic_id = row.get("topicId")
    prompt = row.get("prompt")
    answer = row.get("answer")
    if not all(
        isinstance(value, str) and value.strip()
        for value in (card_id, course_id, topic_id, prompt, answer)
    ):
        return None
    return {
        "id": card_id.strip(),
        "courseId": course_id.strip(),
        "topicId": topic_id.strip(),
        "prompt": prompt.strip(),
        "answer": answer.strip(),
    }


def _scan_cards_table() -> list[dict[str, Any]]:
    table = _cards_table()
    if table is None:
        return []

    response = table.scan()
    rows = list(response.get("Items", []))
    while "LastEvaluatedKey" in response:
        response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])
        rows.extend(response.get("Items", []))
    return [row for row in rows if isinstance(row, dict)]


def _list_runtime_cards_for_course(course_id: str) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    for row in _scan_cards_table():
        if row.get("courseId") != course_id:
            continue
        if row.get("entityType") not in ("Card", None):
            continue
        normalized = _card_row_to_response(row)
        if normalized is None:
            continue
        due_at_raw = row.get("dueAt")
        due_at = due_at_raw.strip() if isinstance(due_at_raw, str) and due_at_raw.strip() else ""
        fsrs_state_raw = row.get("fsrsState")
        fsrs_state = fsrs_state_raw if isinstance(fsrs_state_raw, dict) else None
        cards.append(
            {
                **normalized,
                "dueAt": due_at,
                "fsrsState": fsrs_state,
            }
        )
    cards.sort(key=lambda row: (_safe_timestamp_for_sort(str(row.get("dueAt", ""))), str(row.get("id", ""))))
    return cards


def _persist_generated_cards(cards: list[dict[str, Any]]) -> None:
    table = _cards_table()
    if table is None:
        return

    now = _utc_now_rfc3339()
    for card in cards:
        normalized = _card_row_to_response(
            {
                "cardId": card.get("id"),
                "courseId": card.get("courseId"),
                "topicId": card.get("topicId"),
                "prompt": card.get("prompt"),
                "answer": card.get("answer"),
            }
        )
        if normalized is None:
            continue

        table.put_item(
            Item={
                "cardId": normalized["id"],
                "entityType": "Card",
                "courseId": normalized["courseId"],
                "topicId": normalized["topicId"],
                "prompt": normalized["prompt"],
                "answer": normalized["answer"],
                "dueAt": now,
                "createdAt": now,
                "updatedAt": now,
            }
        )


def _load_prior_fsrs_state(card_row: Mapping[str, Any]) -> dict[str, Any] | None:
    fsrs_state = card_row.get("fsrsState")
    if not isinstance(fsrs_state, dict):
        return None
    required = ("dueAt", "stability", "difficulty", "reps", "lapses", "lastReviewedAt")
    if any(key not in fsrs_state for key in required):
        return None

    return {
        "dueAt": str(fsrs_state["dueAt"]),
        "stability": _safe_float(fsrs_state["stability"], 1.0),
        "difficulty": _safe_float(fsrs_state["difficulty"], 5.0),
        "reps": _safe_int(fsrs_state["reps"], 0),
        "lapses": _safe_int(fsrs_state["lapses"], 0),
        "lastReviewedAt": str(fsrs_state["lastReviewedAt"]),
    }


def _fsrs_rating_from_review_rating(rating: int) -> int:
    if rating <= 1:
        return 1
    if rating == 2:
        return 2
    if rating == 3:
        return 3
    return 4


def _update_card_review_state(*, payload: Mapping[str, Any], reviewed_at: str) -> None:
    table = _cards_table()
    if table is None:
        return

    card_id = str(payload["cardId"]).strip()
    row = table.get_item(Key={"cardId": card_id}).get("Item")
    if not isinstance(row, dict):
        return
    if row.get("courseId") != payload.get("courseId"):
        return

    prior_state = _load_prior_fsrs_state(row)
    rating = _safe_int(payload.get("rating"), 0)
    updated_state = schedule_review(
        prior_state=prior_state,
        rating=_fsrs_rating_from_review_rating(rating),
        now=reviewed_at,
    )
    row["dueAt"] = str(updated_state["dueAt"])
    row["updatedAt"] = _utc_now_rfc3339()
    row["lastReviewedAt"] = str(updated_state["lastReviewedAt"])
    row["fsrsState"] = {
        "dueAt": str(updated_state["dueAt"]),
        "stability": str(updated_state["stability"]),
        "difficulty": str(updated_state["difficulty"]),
        "reps": int(updated_state["reps"]),
        "lapses": int(updated_state["lapses"]),
        "lastReviewedAt": str(updated_state["lastReviewedAt"]),
    }
    row["reviewCount"] = _safe_int(row.get("reviewCount"), 0) + 1
    table.put_item(Item=row)


def _runtime_study_today(course_id: str) -> list[dict[str, Any]]:
    cards = _list_runtime_cards_for_course(course_id)
    if not cards:
        return []

    now = datetime.now(timezone.utc)
    due_cards = [row for row in cards if _is_due_timestamp(str(row.get("dueAt", "")), now)]
    chosen = due_cards if due_cards else cards[:5]
    return [
        {
            "id": str(row["id"]),
            "courseId": str(row["courseId"]),
            "topicId": str(row["topicId"]),
            "prompt": str(row["prompt"]),
            "answer": str(row["answer"]),
        }
        for row in chosen[:50]
    ]


def _runtime_study_mastery(course_id: str) -> list[dict[str, Any]]:
    cards = _list_runtime_cards_for_course(course_id)
    if not cards:
        return []

    now = datetime.now(timezone.utc)
    by_topic: dict[str, list[dict[str, Any]]] = {}
    for row in cards:
        topic_id = str(row["topicId"])
        by_topic.setdefault(topic_id, []).append(row)

    rows: list[dict[str, Any]] = []
    for topic_id, topic_cards in by_topic.items():
        due_cards = sum(1 for row in topic_cards if _is_due_timestamp(str(row.get("dueAt", "")), now))
        mastery_scores: list[float] = []
        for row in topic_cards:
            fsrs_state = row.get("fsrsState")
            if not isinstance(fsrs_state, dict):
                mastery_scores.append(0.0)
                continue
            stability = _safe_float(fsrs_state.get("stability"), 0.0)
            mastery_scores.append(min(1.0, max(0.0, stability / 10.0)))

        mastery_level = round(sum(mastery_scores) / max(len(mastery_scores), 1), 4)
        rows.append(
            {
                "topicId": topic_id,
                "courseId": course_id,
                "masteryLevel": mastery_level,
                "dueCards": due_cards,
            }
        )

    rows.sort(key=lambda row: str(row["topicId"]))
    return rows


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
    materials_total = 0
    materials_mirrored_total = 0
    failed_course_ids_by_user: dict[str, list[str]] = {}
    user_errors: dict[str, str] = {}

    for connection in connections:
        user_id = connection["userId"]
        try:
            courses_upserted, items_upserted, failed_assignment_course_ids = _sync_canvas_assignments_for_user(
                user_id=user_id,
                canvas_base_url=connection["canvasBaseUrl"],
                access_token=connection["accessToken"],
                updated_at=updated_at,
            )
            materials_upserted, materials_mirrored, failed_material_course_ids = _sync_canvas_materials_for_user(
                user_id=user_id,
                canvas_base_url=connection["canvasBaseUrl"],
                access_token=connection["accessToken"],
                updated_at=updated_at,
            )
            failed_course_ids = sorted(
                set(failed_assignment_course_ids).union(failed_material_course_ids),
                key=lambda value: str(value),
            )
            users_succeeded += 1
            courses_total += courses_upserted
            items_total += items_upserted
            materials_total += materials_upserted
            materials_mirrored_total += materials_mirrored
            if failed_course_ids:
                failed_course_ids_by_user[user_id] = failed_course_ids
        except Exception as exc:
            users_failed += 1
            user_errors[user_id] = str(exc)

    kb_ingestion_started = False
    kb_ingestion_job_id = ""
    kb_ingestion_error = ""
    if materials_mirrored_total > 0:
        try:
            kb_ingestion_started, kb_ingestion_job_id, kb_ingestion_error = _start_knowledge_base_ingestion()
        except RuntimeError:
            kb_ingestion_started = False
            kb_ingestion_job_id = ""
            kb_ingestion_error = "unable to start KB ingestion"

    return _json_response(
        200,
        {
            "scheduled": True,
            "connectionsProcessed": len(connections),
            "usersSucceeded": users_succeeded,
            "usersFailed": users_failed,
            "coursesUpserted": courses_total,
            "itemsUpserted": items_total,
            "materialsUpserted": materials_total,
            "materialsMirrored": materials_mirrored_total,
            "knowledgeBaseIngestionStarted": kb_ingestion_started,
            "knowledgeBaseIngestionJobId": kb_ingestion_job_id,
            "knowledgeBaseIngestionError": kb_ingestion_error,
            "failedCourseIdsByUser": failed_course_ids_by_user,
            "userErrors": user_errors,
            "updatedAt": updated_at,
        },
    )


def _query_canvas_items_for_user(user_id: str) -> list[dict[str, Any]]:
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
    items = _query_canvas_items_for_user(user_id)
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

    if method == "POST" and path == "/chat":
        return _handle_chat(event)

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

    if method == "POST" and path == "/generate/flashcards":
        return _handle_generate_flashcards(event)

    if method == "POST" and path == "/generate/practice-exam":
        return _handle_generate_practice_exam(event)

    if method == "GET":
        token = _extract_calendar_token(path, path_params)
        if token is not None:
            return _handle_calendar(token)

    if method == "GET" and path == "/study/today":
        course_id, error = _require_course_id(event)
        if error is not None:
            return error

        runtime_cards = _runtime_study_today(course_id)
        if runtime_cards:
            return _text_response(200, json.dumps(runtime_cards), content_type="application/json")

        cards = [row for row in _load_fixtures()["cards"] if row.get("courseId") == course_id]
        return _text_response(200, json.dumps(cards[:5]), content_type="application/json")

    if method == "POST" and path == "/study/review":
        payload, error = _parse_json_body(event)
        if error is not None:
            return _json_response(400, {"error": error})

        validation_error = _validate_review_payload(payload)
        if validation_error is not None:
            return _json_response(400, {"accepted": False, "error": validation_error})

        reviewed_at = str(payload.get("reviewedAt", "")).strip()
        if reviewed_at:
            _update_card_review_state(payload=payload, reviewed_at=reviewed_at)

        return _json_response(200, {"accepted": True})

    if method == "GET" and path == "/study/mastery":
        course_id, error = _require_course_id(event)
        if error is not None:
            return error

        runtime_rows = _runtime_study_mastery(course_id)
        if runtime_rows:
            return _text_response(200, json.dumps(runtime_rows), content_type="application/json")

        fixtures = _load_fixtures()
        due_cards_by_topic = Counter(str(card["topicId"]) for card in fixtures["cards"] if card.get("courseId") == course_id)

        rows = []
        for topic in fixtures["topics"]:
            if topic.get("courseId") != course_id:
                continue
            rows.append(
                {
                    "topicId": topic["id"],
                    "courseId": course_id,
                    "masteryLevel": topic["masteryLevel"],
                    "dueCards": due_cards_by_topic.get(str(topic["id"]), 0),
                }
            )
        return _text_response(200, json.dumps(rows), content_type="application/json")

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

    return _json_response(404, {"error": "not found"})
