"""Unit tests for Canvas live sync HTTP client normalization logic."""

from __future__ import annotations

import io
import json
import unittest
from email.message import Message
from unittest.mock import patch
from urllib.error import HTTPError

from backend.canvas_client import (
    CanvasApiError,
    fetch_active_courses,
    fetch_current_user_id,
    fetch_course_assignments,
    fetch_course_files,
    fetch_file_bytes,
    normalize_canvas_base_url,
)


class _FakeResponse:
    def __init__(
        self,
        payload: object | bytes,
        link_header: str = "",
        *,
        content_type: str = "application/json",
    ) -> None:
        if isinstance(payload, bytes):
            self._body = payload
        else:
            self._body = json.dumps(payload).encode("utf-8")
        self.headers = Message()
        self.headers["Content-Type"] = content_type
        if link_header:
            self.headers["Link"] = link_header

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


class CanvasClientTests(unittest.TestCase):
    def test_normalize_canvas_base_url_strips_trailing_slash_and_api_path(self) -> None:
        self.assertEqual(normalize_canvas_base_url("https://canvas.calpoly.edu/"), "https://canvas.calpoly.edu")
        self.assertEqual(
            normalize_canvas_base_url("https://canvas.calpoly.edu/api/v1"),
            "https://canvas.calpoly.edu",
        )

    def test_fetch_active_courses_maps_minimal_course_shape(self) -> None:
        payload = [
            {"id": 10, "name": "Biology", "term": {"name": "Fall 2026"}},
            {"id": 11, "name": "Chemistry"},
        ]
        with patch("backend.canvas_client.urlopen", return_value=_FakeResponse(payload)):
            rows = fetch_active_courses(
                base_url="https://canvas.calpoly.edu/",
                token="token",
                user_agent="test-agent",
            )

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["id"], "10")
        self.assertEqual(rows[0]["term"], "Fall 2026")
        self.assertEqual(rows[1]["term"], "Canvas")

    def test_fetch_course_assignments_filters_unpublished_and_missing_due_dates(self) -> None:
        payload = [
            {
                "id": 1,
                "name": "Midterm Exam",
                "published": True,
                "due_at": "2026-10-15T17:00:00Z",
                "points_possible": 100,
            },
            {
                "id": 2,
                "name": "Draft Assignment",
                "published": False,
                "due_at": "2026-09-01T10:00:00Z",
                "points_possible": 10,
            },
            {
                "id": 3,
                "name": "No Due Date",
                "published": True,
                "due_at": None,
                "points_possible": 5,
            },
        ]
        with patch("backend.canvas_client.urlopen", return_value=_FakeResponse(payload)):
            rows = fetch_course_assignments(
                base_url="https://canvas.calpoly.edu/",
                token="token",
                course_id="10",
                user_agent="test-agent",
            )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["courseId"], "10")
        self.assertEqual(rows[0]["itemType"], "exam")

    def test_fetch_course_assignments_raises_for_http_error(self) -> None:
        error = HTTPError(
            url="https://canvas.calpoly.edu/api/v1/courses",
            code=401,
            msg="unauthorized",
            hdrs=None,
            fp=io.BytesIO(b"{\"errors\":[{\"message\":\"Invalid access token\"}]}"),
        )
        with patch("backend.canvas_client.urlopen", side_effect=error):
            with self.assertRaises(CanvasApiError):
                fetch_course_assignments(
                    base_url="https://canvas.calpoly.edu/",
                    token="bad-token",
                    course_id="10",
                    user_agent="test-agent",
                )

    def test_fetch_current_user_id_reads_profile_id(self) -> None:
        payload = {"id": 4242, "name": "Student"}
        with patch("backend.canvas_client.urlopen", return_value=_FakeResponse(payload)):
            user_id = fetch_current_user_id(
                base_url="https://canvas.calpoly.edu/",
                token="token",
                user_agent="test-agent",
            )

        self.assertEqual(user_id, "4242")

    def test_fetch_course_files_filters_hidden_and_unpublished(self) -> None:
        payload = [
            {
                "id": 2001,
                "display_name": "Syllabus.pdf",
                "content-type": "application/pdf",
                "size": 4096,
                "updated_at": "2026-09-01T10:00:00Z",
                "url": "https://canvas.calpoly.edu/files/2001/download",
                "published": True,
            },
            {
                "id": 2002,
                "display_name": "Hidden.pdf",
                "content-type": "application/pdf",
                "size": 1024,
                "updated_at": "2026-09-01T10:05:00Z",
                "url": "https://canvas.calpoly.edu/files/2002/download",
                "hidden": True,
                "published": True,
            },
            {
                "id": 2003,
                "display_name": "Unpublished.pdf",
                "content-type": "application/pdf",
                "size": 1024,
                "updated_at": "2026-09-01T10:06:00Z",
                "url": "https://canvas.calpoly.edu/files/2003/download",
                "published": False,
            },
        ]
        with patch("backend.canvas_client.urlopen", return_value=_FakeResponse(payload)):
            rows = fetch_course_files(
                base_url="https://canvas.calpoly.edu/",
                token="token",
                course_id="10",
                user_agent="test-agent",
            )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["canvasFileId"], "2001")
        self.assertEqual(rows[0]["courseId"], "10")
        self.assertEqual(rows[0]["displayName"], "Syllabus.pdf")
        self.assertEqual(rows[0]["contentType"], "application/pdf")
        self.assertEqual(rows[0]["sizeBytes"], 4096)
        self.assertEqual(rows[0]["updatedAt"], "2026-09-01T10:00:00Z")

    def test_fetch_file_bytes_returns_body_and_content_type(self) -> None:
        with patch(
            "backend.canvas_client.urlopen",
            return_value=_FakeResponse(b"pdf-data", content_type="application/pdf"),
        ):
            body, content_type = fetch_file_bytes(
                url="https://canvas.calpoly.edu/files/2001/download",
                token="token",
                user_agent="test-agent",
            )
        self.assertEqual(body, b"pdf-data")
        self.assertEqual(content_type, "application/pdf")


if __name__ == "__main__":
    unittest.main()
