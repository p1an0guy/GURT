"""Canvas REST client for assignments + course-material sync."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

_EXAM_PATTERN = re.compile(r"\b(midterm|final|exam)\b", re.IGNORECASE)
_QUIZ_PATTERN = re.compile(r"\bquiz\b", re.IGNORECASE)
_DEFAULT_TIMEOUT_SECONDS = 20


class CanvasApiError(RuntimeError):
    """Raised when Canvas API requests fail or return malformed payloads."""


class CanvasAccessDeniedError(CanvasApiError):
    """Raised when Canvas returns 403 (user not authorized)."""


def normalize_canvas_base_url(base_url: str) -> str:
    """Normalize user-provided Canvas base URL to a host root URL."""
    normalized = base_url.strip().rstrip("/")
    if normalized.lower().endswith("/api/v1"):
        normalized = normalized[: -len("/api/v1")]
    return normalized


def _request_json(*, url: str, token: str, user_agent: str) -> tuple[Any, dict[str, str]]:
    req = Request(
        url=url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": user_agent,
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=_DEFAULT_TIMEOUT_SECONDS) as resp:
            raw = resp.read().decode("utf-8")
            payload = json.loads(raw)
            headers = {k.lower(): v for k, v in resp.headers.items()}
            return payload, headers
    except HTTPError as exc:  # pragma: no cover - network path
        detail = exc.read().decode("utf-8", errors="ignore")
        if exc.code == 403:
            raise CanvasAccessDeniedError(f"canvas access denied (403) for {url}: {detail}") from exc
        raise CanvasApiError(f"canvas request failed ({exc.code}) for {url}: {detail}") from exc
    except URLError as exc:  # pragma: no cover - network path
        raise CanvasApiError(f"canvas request failed for {url}: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise CanvasApiError(f"canvas response was not valid JSON for {url}") from exc


def _extract_next_link(link_header: str) -> str | None:
    for part in link_header.split(","):
        segment = part.strip()
        if 'rel="next"' not in segment:
            continue
        if "<" not in segment or ">" not in segment:
            continue
        return segment[segment.find("<") + 1 : segment.find(">")]
    return None


def _get_paginated_json(*, url: str, token: str, user_agent: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    next_url: str | None = url
    while next_url:
        payload, headers = _request_json(url=next_url, token=token, user_agent=user_agent)
        if not isinstance(payload, list):
            raise CanvasApiError(f"canvas response expected list for {next_url}")

        for row in payload:
            if isinstance(row, dict):
                rows.append(row)

        next_url = _extract_next_link(headers.get("link", ""))
    return rows


def _to_rfc3339_utc(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _course_color(course_id: str) -> str:
    palette = ("#3366FF", "#22AA88", "#CC6655", "#4477AA", "#AA8844", "#1177AA")
    checksum = sum(ord(ch) for ch in course_id)
    return palette[checksum % len(palette)]


def fetch_active_courses(*, base_url: str, token: str, user_agent: str) -> list[dict[str, Any]]:
    """Fetch active Canvas courses and map to Course contract shape."""
    root = normalize_canvas_base_url(base_url)
    query = urlencode({"enrollment_state": "active", "per_page": 100})
    rows = _get_paginated_json(
        url=f"{root}/api/v1/courses?{query}",
        token=token,
        user_agent=user_agent,
    )

    courses: list[dict[str, Any]] = []
    for row in rows:
        course_id = row.get("id")
        name = row.get("name")
        if course_id is None or not isinstance(name, str) or not name.strip():
            continue

        term = "Canvas"
        term_obj = row.get("term")
        if isinstance(term_obj, dict):
            term_name = term_obj.get("name")
            if isinstance(term_name, str) and term_name.strip():
                term = term_name.strip()

        course_id_text = str(course_id)
        courses.append(
            {
                "id": course_id_text,
                "name": name.strip(),
                "term": term,
                "color": _course_color(course_id_text),
            }
        )

    courses.sort(key=lambda c: str(c["name"]).lower())
    return courses


def fetch_current_user_id(*, base_url: str, token: str, user_agent: str) -> str:
    """Fetch the Canvas caller id for per-user demo data isolation."""
    root = normalize_canvas_base_url(base_url)
    payload, _ = _request_json(
        url=f"{root}/api/v1/users/self/profile",
        token=token,
        user_agent=user_agent,
    )
    if not isinstance(payload, dict):
        raise CanvasApiError("canvas response expected object for /api/v1/users/self/profile")
    user_id = payload.get("id")
    if user_id is None:
        raise CanvasApiError("canvas response missing user id for /api/v1/users/self/profile")
    return str(user_id)


def _assignment_item_type(assignment: dict[str, Any]) -> str:
    title = str(assignment.get("name", ""))
    if assignment.get("quiz_id") is not None or _QUIZ_PATTERN.search(title):
        return "quiz"
    if _EXAM_PATTERN.search(title):
        return "exam"
    return "assignment"


def fetch_course_assignments(
    *,
    base_url: str,
    token: str,
    course_id: str,
    user_agent: str,
) -> list[dict[str, Any]]:
    """Fetch published assignments with due dates for a specific course."""
    root = normalize_canvas_base_url(base_url)
    query = urlencode({"per_page": 100, "order_by": "due_at"})
    rows = _get_paginated_json(
        url=f"{root}/api/v1/courses/{course_id}/assignments?{query}",
        token=token,
        user_agent=user_agent,
    )

    items: list[dict[str, Any]] = []
    for row in rows:
        if row.get("published") is not True:
            continue

        due_at = row.get("due_at")
        if not isinstance(due_at, str) or not due_at.strip():
            continue

        assignment_id = row.get("id")
        title = row.get("name")
        if assignment_id is None or not isinstance(title, str) or not title.strip():
            continue

        points = row.get("points_possible")
        if not isinstance(points, (int, float)) or isinstance(points, bool) or points < 0:
            points = 0

        items.append(
            {
                "id": str(assignment_id),
                "courseId": str(course_id),
                "title": title.strip(),
                "itemType": _assignment_item_type(row),
                "dueAt": _to_rfc3339_utc(due_at),
                "pointsPossible": points,
            }
        )

    items.sort(key=lambda i: str(i["dueAt"]))
    return items


def _normalize_content_type(row: dict[str, Any]) -> str:
    content_type = row.get("content-type")
    if not isinstance(content_type, str) or not content_type.strip():
        content_type = row.get("content_type")
    if not isinstance(content_type, str) or not content_type.strip():
        return "application/octet-stream"
    return content_type.strip().lower()


def fetch_course_files(
    *,
    base_url: str,
    token: str,
    course_id: str,
    user_agent: str,
) -> list[dict[str, Any]]:
    """Fetch visible, published course files for a specific course."""
    root = normalize_canvas_base_url(base_url)
    query = urlencode({"per_page": 100, "sort": "updated_at", "order": "desc"})
    rows = _get_paginated_json(
        url=f"{root}/api/v1/courses/{course_id}/files?{query}",
        token=token,
        user_agent=user_agent,
    )

    items: list[dict[str, Any]] = []
    for row in rows:
        if row.get("published") is False:
            continue
        if row.get("hidden") is True:
            continue
        if row.get("locked_for_user") is True:
            continue

        file_id = row.get("id")
        if file_id is None:
            continue

        display_name = row.get("display_name")
        if not isinstance(display_name, str) or not display_name.strip():
            display_name = row.get("filename")
        if not isinstance(display_name, str) or not display_name.strip():
            continue

        updated_at = row.get("updated_at")
        if not isinstance(updated_at, str) or not updated_at.strip():
            continue

        download_url = row.get("url")
        if not isinstance(download_url, str) or not download_url.strip():
            continue

        size = row.get("size")
        if not isinstance(size, int) or size < 0:
            size = 0

        items.append(
            {
                "canvasFileId": str(file_id),
                "courseId": str(course_id),
                "displayName": display_name.strip(),
                "contentType": _normalize_content_type(row),
                "sizeBytes": size,
                "updatedAt": _to_rfc3339_utc(updated_at),
                "downloadUrl": download_url.strip(),
            }
        )

    items.sort(key=lambda i: str(i["updatedAt"]), reverse=True)
    return items


def fetch_file_bytes(*, url: str, token: str, user_agent: str) -> tuple[bytes, str]:
    """Fetch file bytes and return `(payload, content_type)`."""
    req = Request(
        url=url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "*/*",
            "User-Agent": user_agent,
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=_DEFAULT_TIMEOUT_SECONDS) as resp:
            content_type = str(resp.headers.get("Content-Type", "")).strip().lower()
            payload = resp.read()
            return payload, content_type
    except HTTPError as exc:  # pragma: no cover - network path
        detail = exc.read().decode("utf-8", errors="ignore")
        raise CanvasApiError(f"canvas file request failed ({exc.code}) for {url}: {detail}") from exc
    except URLError as exc:  # pragma: no cover - network path
        raise CanvasApiError(f"canvas file request failed for {url}: {exc.reason}") from exc
