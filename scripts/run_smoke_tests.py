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


class FixtureMockHandler(BaseHTTPRequestHandler):
    """Lightweight local HTTP API that serves deterministic fixture responses."""

    fixtures = {
        "courses": load_json(FIXTURES / "courses.json"),
        "items": load_json(FIXTURES / "canvas_items.json"),
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

        self._write_json({"error": "not found"}, status=404)

    def do_POST(self) -> None:  # noqa: N802
        """Handle deterministic POST route for review ack."""
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


def http_text(url: str) -> str:
    """Execute HTTP GET and return text response."""
    with urlopen(url, timeout=15) as resp:
        return resp.read().decode("utf-8")


def validate_rows(rows: List[Dict[str, Any]], schema_name: str, label: str) -> None:
    """Validate each object in a list against a schema."""
    schema = read_schema(schema_name)
    for row in rows:
        validate_instance(row, schema)
    print(f"PASS {label}: {len(rows)} record(s)")


def validate_ics(ics_text: str) -> None:
    """Perform basic deterministic iCalendar checks."""
    text = ics_text.replace("\r\n", "\n")
    if "BEGIN:VCALENDAR" not in text or "END:VCALENDAR" not in text:
        raise RuntimeError("ICS validation failed: missing VCALENDAR boundaries")
    if text.count("BEGIN:VEVENT") < 1:
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

    courses = http_json("GET", f"{ctx.base_url}/courses")
    validate_rows(courses, "Course.json", "/courses")

    items = http_json("GET", f"{ctx.base_url}/courses/{ctx.course_id}/items")
    validate_rows(items, "CanvasItem.json", "/courses/{courseId}/items")

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

    ics_text = http_text(f"{ctx.base_url}/calendar/{ctx.calendar_token}.ics")
    validate_ics(ics_text)


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
    calendar_token = (
        initial_calendar_token or "demo-calendar-token"
        if mock_mode
        else resolve_calendar_token(
            base_url=base_url,
            initial_token=initial_calendar_token,
            mint_if_missing=mint_calendar_token,
        )
    )
    ctx = SmokeContext(base_url=base_url, calendar_token=calendar_token, course_id=course_id)

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
