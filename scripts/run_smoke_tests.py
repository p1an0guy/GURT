#!/usr/bin/env python3
"""Run deterministic smoke tests against BASE_URL or an in-process mock API."""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

from schema_utils import SchemaValidationError, validate_instance

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "fixtures"
SCHEMAS = ROOT / "contracts" / "schemas"


def load_json(path: Path) -> Any:
    """Load a JSON file from disk."""
    return json.loads(path.read_text(encoding="utf-8"))


@dataclass
class SmokeContext:
    """Runtime data used by test steps."""

    base_url: str
    calendar_token: str
    course_id: str
    require_ics_event: bool = False
    include_canvas_sync: bool = False
    include_chat: bool = False
    include_ingest: bool = False
    expected_material_ids: List[str] | None = None


class FixtureMockHandler(BaseHTTPRequestHandler):
    """Lightweight local HTTP API that serves deterministic fixture responses."""

    fixtures = {
        "courses": load_json(FIXTURES / "courses.json"),
        "items": load_json(FIXTURES / "canvas_items.json"),
        "materials": load_json(FIXTURES / "course_materials.json"),
        "topics": load_json(FIXTURES / "topics.json"),
        "cards": load_json(FIXTURES / "cards.json"),
    }

    ics_payload = "\r\n".join(
        [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//GURT//Smoke Fixture//EN",
            "BEGIN:VEVENT",
            "UID:event-1@gurt.local",
            "DTSTAMP:20260901T120000Z",
            "DTSTART:20260905T235900Z",
            "DTEND:20260906T005900Z",
            "SUMMARY:Week 1 Reflection Due",
            "END:VEVENT",
            "END:VCALENDAR",
            "",
        ]
    )
    ingest_job_id = "smoke-ingest-job-1"

    def _write_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _write_ics(self, payload: str, status: int = 200) -> None:
        body = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/calendar")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        """Handle deterministic GET API routes for smoke tests."""
        parsed = urlparse(self.path)
        route = parsed.path
        query = parse_qs(parsed.query)

        if route == "/health":
            self._write_json({"status": "ok"})
            return

        if route == "/courses":
            self._write_json(self.fixtures["courses"])
            return

        if route.startswith("/courses/") and route.endswith("/items"):
            course_id = route.split("/")[2]
            rows = [x for x in self.fixtures["items"] if x["courseId"] == course_id]
            self._write_json(rows)
            return

        if route.startswith("/courses/") and route.endswith("/materials"):
            course_id = route.split("/")[2]
            rows = [x for x in self.fixtures["materials"] if x["courseId"] == course_id]
            rows.sort(key=lambda row: str(row.get("displayName", "")).lower())
            self._write_json(rows)
            return

        if route == "/study/today":
            course_id = query.get("courseId", [""])[0]
            rows = [x for x in self.fixtures["cards"] if x["courseId"] == course_id][:5]
            self._write_json(rows)
            return

        if route == "/study/mastery":
            course_id = query.get("courseId", [""])[0]
            rows = [
                {
                    "topicId": t["id"],
                    "courseId": course_id,
                    "masteryLevel": t["masteryLevel"],
                    "dueCards": 2,
                }
                for t in self.fixtures["topics"]
                if t["courseId"] == course_id
            ]
            self._write_json(rows)
            return

        if route.startswith("/calendar/") and route.endswith(".ics"):
            self._write_ics(self.ics_payload)
            return

        if route == f"/docs/ingest/{self.ingest_job_id}":
            self._write_json(
                {
                    "jobId": self.ingest_job_id,
                    "status": "FINISHED",
                    "textLength": 1024,
                    "usedTextract": False,
                    "updatedAt": "2026-09-01T10:15:02Z",
                    "error": "",
                }
            )
            return

        self._write_json({"error": "not found"}, status=404)

    def do_POST(self) -> None:  # noqa: N802
        """Handle deterministic POST routes used by smoke checks."""
        if self.path == "/calendar/token":
            self._write_json(
                {
                    "token": "smoke-calendar-token",
                    "feedUrl": "/calendar/smoke-calendar-token.ics",
                    "createdAt": "2026-09-01T10:15:00Z",
                },
                status=201,
            )
            return

        if self.path == "/docs/ingest":
            self._write_json(
                {
                    "jobId": self.ingest_job_id,
                    "status": "RUNNING",
                    "updatedAt": "2026-09-01T10:15:01Z",
                }
            )
            return

        if self.path == "/canvas/connect":
            self._write_json(
                {
                    "connected": True,
                    "updatedAt": "2026-09-01T10:15:00Z",
                }
            )
            return

        if self.path == "/canvas/sync":
            self._write_json(
                {
                    "synced": True,
                    "coursesUpserted": 2,
                    "itemsUpserted": 3,
                    "materialsUpserted": 2,
                    "materialsMirrored": 2,
                    "knowledgeBaseIngestionStarted": False,
                    "knowledgeBaseIngestionJobId": "",
                    "knowledgeBaseIngestionError": "",
                    "failedCourseIds": [],
                    "updatedAt": "2026-09-01T10:15:01Z",
                }
            )
            return

        if self.path == "/chat":
            self._write_json(
                {
                    "answer": "Use active recall and spaced repetition for this topic.",
                    "citations": ["s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-2"],
                    "citationDetails": [
                        {
                            "source": "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-2",
                            "label": "ch1.pdf (chunk-2)",
                            "url": "https://bucket.s3.us-west-2.amazonaws.com/uploads/170880/doc-a/ch1.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=example",
                        }
                    ],
                }
            )
            return

        if self.path != "/study/review":
            self._write_json({"error": "not found"}, status=404)
            return

        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        payload = json.loads(raw.decode("utf-8"))
        required = {"cardId", "courseId", "rating", "reviewedAt"}
        if not required.issubset(payload.keys()):
            self._write_json({"accepted": False}, status=400)
            return

        self._write_json({"accepted": True})

    def log_message(self, fmt: str, *args: object) -> None:
        """Silence HTTP server logs for deterministic smoke output."""
        return


def read_schema(name: str) -> Dict[str, Any]:
    """Load a JSON schema by filename."""
    return load_json(SCHEMAS / name)


def http_json(method: str, url: str, payload: Dict[str, Any] | None = None) -> Any:
    """Execute HTTP request and return parsed JSON body."""
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = Request(url, method=method, data=data, headers=headers)

    try:
        with urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {exc.code} for {method} {url}: {detail}") from exc

    return json.loads(body)


def http_text(url: str) -> tuple[str, str]:
    """Execute HTTP GET and return text response plus content type."""
    with urlopen(url, timeout=15) as resp:
        content_type = resp.headers.get("Content-Type", "")
        body = resp.read().decode("utf-8")
    return body, content_type


def validate_rows(rows: List[Dict[str, Any]], schema_name: str, label: str) -> None:
    """Validate each object in a list against a schema."""
    schema = read_schema(schema_name)
    for row in rows:
        validate_instance(row, schema)
    print(f"PASS {label}: {len(rows)} record(s)")


def validate_material_rows(
    rows: List[Dict[str, Any]],
    *,
    course_id: str,
    expected_material_ids: List[str] | None,
) -> None:
    """Assert materials metadata behavior shared by mock and deployed smoke runs."""
    for row in rows:
        if row.get("courseId") != course_id:
            raise RuntimeError(
                f"Materials validation failed: expected courseId={course_id}, got {row.get('courseId')!r}"
            )
        if "downloadUrl" in row or "s3Key" in row:
            raise RuntimeError("Materials validation failed: response leaked private material fields")

    display_names = [str(row.get("displayName", "")) for row in rows]
    if display_names != sorted(display_names, key=str.lower):
        raise RuntimeError("Materials validation failed: rows must be sorted by displayName")

    if expected_material_ids is not None:
        actual_ids = sorted(str(row.get("canvasFileId", "")) for row in rows)
        if actual_ids != expected_material_ids:
            raise RuntimeError(
                "Materials validation failed: deterministic mock IDs mismatch "
                f"(expected={expected_material_ids}, actual={actual_ids})"
            )

    print("PASS /courses/{courseId}/materials metadata assertions")


def validate_ics(ics_text: str, *, content_type: str, require_event: bool) -> None:
    """Perform iCalendar checks while avoiding live-data flakiness."""
    if "text/calendar" not in content_type.lower():
        raise RuntimeError(f"ICS validation failed: unexpected content type '{content_type or 'missing'}'")

    text = ics_text.replace("\r\n", "\n")
    if "BEGIN:VCALENDAR" not in text or "END:VCALENDAR" not in text:
        raise RuntimeError("ICS validation failed: missing VCALENDAR boundaries")
    if require_event and text.count("BEGIN:VEVENT") < 1:
        raise RuntimeError("ICS validation failed: expected at least one VEVENT")
    print("PASS calendar ICS checks")


def resolve_calendar_token(*, base_url: str, initial_token: str, mint_if_missing: bool) -> str:
    """Resolve calendar token from env or mint endpoint for live smoke runs."""
    if initial_token:
        return initial_token
    if not mint_if_missing:
        return "demo-calendar-token"

    payload = http_json("POST", f"{base_url}/calendar/token", payload={})
    token = str(payload.get("token", "")).strip() if isinstance(payload, dict) else ""
    if not token:
        raise RuntimeError("calendar token mint failed: response missing token")
    print("PASS /calendar/token")
    return token


def run_sequence(ctx: SmokeContext) -> None:
    """Run the requested smoke sequence and validate response shapes."""
    health = http_json("GET", f"{ctx.base_url}/health")
    if health.get("status") != "ok":
        raise RuntimeError(f"Health check failed: {health}")
    print("PASS /health")

    if ctx.include_canvas_sync:
        connect_payload = {
            "canvasBaseUrl": "https://canvas.example.edu",
            "accessToken": "demo-token",
        }
        validate_instance(connect_payload, read_schema("CanvasConnectRequest.json"))
        connect_response = http_json("POST", f"{ctx.base_url}/canvas/connect", payload=connect_payload)
        validate_instance(connect_response, read_schema("CanvasConnectResponse.json"))
        print("PASS /canvas/connect")

        sync_response = http_json("POST", f"{ctx.base_url}/canvas/sync", payload={})
        validate_instance(sync_response, read_schema("CanvasSyncResponse.json"))
        print("PASS /canvas/sync")

    courses = http_json("GET", f"{ctx.base_url}/courses")
    validate_rows(courses, "Course.json", "/courses")

    items = http_json("GET", f"{ctx.base_url}/courses/{ctx.course_id}/items")
    validate_rows(items, "CanvasItem.json", "/courses/{courseId}/items")

    materials = http_json("GET", f"{ctx.base_url}/courses/{ctx.course_id}/materials")
    validate_rows(materials, "CourseMaterial.json", "/courses/{courseId}/materials")
    validate_material_rows(
        materials,
        course_id=ctx.course_id,
        expected_material_ids=ctx.expected_material_ids,
    )

    query = urlencode({"courseId": ctx.course_id})
    cards = http_json("GET", f"{ctx.base_url}/study/today?{query}")
    validate_rows(cards, "Card.json", "/study/today")

    review_payload = {
        "cardId": cards[0]["id"] if cards else "card-001",
        "courseId": ctx.course_id,
        "rating": 4,
        "reviewedAt": "2026-09-01T10:15:00Z",
    }
    validate_instance(review_payload, read_schema("ReviewEvent.json"))
    review_resp = http_json("POST", f"{ctx.base_url}/study/review", payload=review_payload)
    if review_resp.get("accepted") is not True:
        raise RuntimeError(f"Review submit failed: {review_resp}")
    print("PASS /study/review")

    mastery = http_json("GET", f"{ctx.base_url}/study/mastery?{query}")
    validate_rows(mastery, "TopicMastery.json", "/study/mastery")

    if ctx.include_chat:
        chat_payload = {
            "courseId": ctx.course_id,
            "question": "What should I focus on this week?",
        }
        validate_instance(chat_payload, read_schema("ChatRequest.json"))
        chat_response = http_json("POST", f"{ctx.base_url}/chat", payload=chat_payload)
        validate_instance(chat_response, read_schema("ChatResponse.json"))
        print("PASS /chat")

    if ctx.include_ingest:
        ingest_payload = {
            "docId": "doc-smoke-001",
            "courseId": ctx.course_id,
            "key": "uploads/smoke/doc-smoke-001.pdf",
        }
        validate_instance(ingest_payload, read_schema("IngestStartRequest.json"))
        ingest_start = http_json("POST", f"{ctx.base_url}/docs/ingest", payload=ingest_payload)
        validate_instance(ingest_start, read_schema("IngestStartResponse.json"))
        print("PASS /docs/ingest")

        ingest_status = http_json("GET", f"{ctx.base_url}/docs/ingest/{ingest_start['jobId']}")
        validate_instance(ingest_status, read_schema("IngestStatusResponse.json"))
        if ingest_status.get("status") == "FAILED":
            raise RuntimeError(f"Ingest status failed: {ingest_status}")
        print("PASS /docs/ingest/{jobId}")

    ics_text, content_type = http_text(f"{ctx.base_url}/calendar/{ctx.calendar_token}.ics")
    validate_ics(ics_text, content_type=content_type, require_event=ctx.require_ics_event)


def start_mock_server() -> tuple[ThreadingHTTPServer, str]:
    """Start local fixture API server for CI mock mode."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureMockHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_port}"


def main() -> None:
    """Resolve settings and run smoke tests with concise status output."""
    mock_mode = os.getenv("SMOKE_MOCK_MODE", "0") == "1"
    base_url = os.getenv("BASE_URL", "").rstrip("/")

    server = None
    if mock_mode:
        server, base_url = start_mock_server()
        print(f"INFO mock server started at {base_url}")

    if not base_url:
        raise RuntimeError("BASE_URL is required unless SMOKE_MOCK_MODE=1")

    course_id = os.getenv("COURSE_ID", "").strip() or "course-psych-101"
    initial_calendar_token = os.getenv("CALENDAR_TOKEN", "").strip()
    mint_calendar_token = os.getenv("MINT_CALENDAR_TOKEN", "0").strip() == "1"
    include_canvas_sync = os.getenv("SMOKE_INCLUDE_CANVAS_SYNC", "0").strip() == "1"
    include_chat = os.getenv("SMOKE_INCLUDE_CHAT", "0").strip() == "1"
    include_ingest = os.getenv("SMOKE_INCLUDE_INGEST", "0").strip() == "1"
    # Require at least one VEVENT only in deterministic fixture mode unless explicitly overridden.
    require_ics_event = os.getenv("SMOKE_REQUIRE_ICS_EVENT", "").strip() == "1" or mock_mode
    calendar_token = resolve_calendar_token(
        base_url=base_url,
        initial_token=initial_calendar_token,
        mint_if_missing=mint_calendar_token,
    )
    expected_material_ids = None
    if mock_mode:
        expected_material_ids = sorted(
            str(row.get("canvasFileId", ""))
            for row in FixtureMockHandler.fixtures["materials"]
            if row.get("courseId") == course_id
        )
    ctx = SmokeContext(
        base_url=base_url,
        calendar_token=calendar_token,
        course_id=course_id,
        require_ics_event=require_ics_event,
        include_canvas_sync=include_canvas_sync,
        include_chat=include_chat,
        include_ingest=include_ingest,
        expected_material_ids=expected_material_ids,
    )

    try:
        run_sequence(ctx)
        print("Smoke tests passed.")
    except (RuntimeError, SchemaValidationError) as exc:
        raise SystemExit(f"Smoke test failed: {exc}") from exc
    finally:
        if server is not None:
            server.shutdown()


if __name__ == "__main__":
    main()
