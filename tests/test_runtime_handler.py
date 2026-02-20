"""Unit tests for API runtime lambda routing and calendar token checks."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from gurt.calendar_tokens.model import CalendarTokenRecord
from backend.runtime import lambda_handler


class _MemoryCalendarTokenStore:
    def __init__(self) -> None:
        self.rows: dict[str, CalendarTokenRecord] = {}

    def save(self, record: CalendarTokenRecord) -> None:
        self.rows[record.token] = record

    def get(self, token: str) -> CalendarTokenRecord | None:
        return self.rows.get(token)


class RuntimeHandlerTests(unittest.TestCase):
    def _invoke(self, event: dict, env: dict[str, str] | None = None) -> dict:
        env_vars = {"DEMO_MODE": "true"}
        if env is not None:
            env_vars.update(env)

        with patch.dict("os.environ", env_vars, clear=True):
            return lambda_handler(event, None)

    def test_health_route_returns_ok(self) -> None:
        response = self._invoke({"httpMethod": "GET", "path": "/health"}, env={"DEMO_MODE": "false"})
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(json.loads(response["body"]), {"status": "ok"})

    def test_health_route_accepts_stage_prefixed_path(self) -> None:
        response = self._invoke(
            {
                "httpMethod": "GET",
                "path": "/dev/health",
                "requestContext": {"stage": "dev"},
            },
            env={"DEMO_MODE": "false"},
        )

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(json.loads(response["body"]), {"status": "ok"})

    def test_courses_route_uses_fixture_data(self) -> None:
        response = self._invoke({"httpMethod": "GET", "path": "/courses"})

        self.assertEqual(response["statusCode"], 200)
        rows = json.loads(response["body"])
        self.assertGreaterEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "course-psych-101")

    def test_courses_route_returns_503_when_demo_mode_disabled(self) -> None:
        response = self._invoke(
            {"httpMethod": "GET", "path": "/courses"},
            env={"DEMO_MODE": "false"},
        )

        self.assertEqual(response["statusCode"], 503)

    def test_course_items_filters_by_course_id(self) -> None:
        response = self._invoke(
            {
                "httpMethod": "GET",
                "path": "/courses/course-psych-101/items",
                "pathParameters": {"courseId": "course-psych-101"},
            }
        )

        self.assertEqual(response["statusCode"], 200)
        rows = json.loads(response["body"])
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["courseId"] == "course-psych-101" for row in rows))

    def test_course_items_accepts_stage_prefixed_path(self) -> None:
        response = self._invoke(
            {
                "httpMethod": "GET",
                "path": "/dev/courses/course-psych-101/items",
                "requestContext": {"stage": "dev"},
                "pathParameters": {"courseId": "course-psych-101"},
            }
        )

        self.assertEqual(response["statusCode"], 200)
        rows = json.loads(response["body"])
        self.assertEqual(len(rows), 2)

    def test_study_today_requires_course_id_query_parameter(self) -> None:
        response = self._invoke({"httpMethod": "GET", "path": "/study/today"})

        self.assertEqual(response["statusCode"], 400)
        self.assertIn("courseId", json.loads(response["body"])["error"])

    def test_study_review_accepts_valid_payload(self) -> None:
        payload = {
            "cardId": "card-001",
            "courseId": "course-psych-101",
            "rating": 4,
            "reviewedAt": "2026-09-01T10:15:00Z",
        }
        response = self._invoke(
            {
                "httpMethod": "POST",
                "path": "/study/review",
                "body": json.dumps(payload),
            }
        )

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(json.loads(response["body"]), {"accepted": True})

    def test_study_review_rejects_out_of_range_rating(self) -> None:
        payload = {
            "cardId": "card-001",
            "courseId": "course-psych-101",
            "rating": 8,
            "reviewedAt": "2026-09-01T10:15:00Z",
        }
        response = self._invoke(
            {
                "httpMethod": "POST",
                "path": "/study/review",
                "body": json.dumps(payload),
            }
        )

        self.assertEqual(response["statusCode"], 400)
        self.assertEqual(json.loads(response["body"])["accepted"], False)

    def test_study_mastery_uses_fixture_topics_and_due_counts(self) -> None:
        response = self._invoke(
            {
                "httpMethod": "GET",
                "path": "/study/mastery",
                "queryStringParameters": {"courseId": "course-psych-101"},
            }
        )

        self.assertEqual(response["statusCode"], 200)
        rows = json.loads(response["body"])
        by_topic = {row["topicId"]: row for row in rows}
        self.assertEqual(by_topic["topic-memory"]["dueCards"], 3)
        self.assertEqual(by_topic["topic-conditioning"]["dueCards"], 3)

    def test_calendar_token_create_requires_authenticated_principal(self) -> None:
        response = self._invoke(
            {"httpMethod": "POST", "path": "/calendar/token"},
        )

        self.assertEqual(response["statusCode"], 401)
        self.assertIn("authenticated principal", json.loads(response["body"])["error"])

    def test_calendar_token_create_persists_token_and_returns_feed_url(self) -> None:
        store = _MemoryCalendarTokenStore()
        event = {
            "httpMethod": "POST",
            "path": "/calendar/token",
            "headers": {"host": "api.example.test", "x-forwarded-proto": "https"},
            "requestContext": {"stage": "dev", "authorizer": {"principalId": "demo-user"}},
        }
        with patch("backend.runtime._calendar_token_store", return_value=store):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 201)
        body = json.loads(response["body"])
        self.assertIn("token", body)
        self.assertEqual(body["createdAt"], store.get(body["token"]).created_at)  # type: ignore[union-attr]
        self.assertEqual(
            body["feedUrl"],
            f"https://api.example.test/dev/calendar/{body['token']}.ics",
        )

    def test_calendar_route_looks_up_token_and_uses_associated_user(self) -> None:
        store = _MemoryCalendarTokenStore()
        store.save(
            CalendarTokenRecord.mint(
                token="calendar-token-1",
                user_id="demo-user",
                created_at="2026-09-01T10:15:00Z",
            )
        )
        event = {
            "httpMethod": "GET",
            "path": "/calendar/calendar-token-1.ics",
            "pathParameters": {"token": "calendar-token-1"},
        }

        with (
            patch("backend.runtime._calendar_token_store", return_value=store),
            patch(
                "backend.runtime._load_schedule_items_for_user",
                return_value=[
                    {
                        "id": "item-123",
                        "courseId": "course-psych-101",
                        "title": "Midterm Exam",
                        "dueAt": "2026-10-15T17:00:00Z",
                    }
                ],
            ) as load_items,
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(response["headers"]["Content-Type"], "text/calendar")
        self.assertIn("BEGIN:VCALENDAR", response["body"])
        self.assertIn("SUMMARY:Midterm Exam", response["body"])
        load_items.assert_called_once_with("demo-user")

    def test_calendar_route_returns_404_for_unknown_token(self) -> None:
        store = _MemoryCalendarTokenStore()
        with patch("backend.runtime._calendar_token_store", return_value=store):
            response = self._invoke(
                {"httpMethod": "GET", "path": "/calendar/missing.ics", "pathParameters": {"token": "missing"}},
                env={"DEMO_MODE": "false"},
            )

        self.assertEqual(response["statusCode"], 404)

    def test_calendar_route_accepts_stage_prefixed_path(self) -> None:
        store = _MemoryCalendarTokenStore()
        store.save(
            CalendarTokenRecord.mint(
                token="demo-calendar-token",
                user_id="demo-user",
                created_at="2026-09-01T10:15:00Z",
            )
        )
        response_event = {
            "httpMethod": "GET",
            "path": "/dev/calendar/demo-calendar-token.ics",
            "requestContext": {"stage": "dev"},
            "pathParameters": {"token_ics": "demo-calendar-token.ics"},
        }
        with patch("backend.runtime._calendar_token_store", return_value=store):
            response = self._invoke(response_event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        self.assertIn("BEGIN:VCALENDAR", response["body"])

    def test_calendar_route_returns_500_when_token_table_is_unavailable(self) -> None:
        with patch(
            "backend.runtime._calendar_token_store",
            side_effect=RuntimeError("server misconfiguration: CALENDAR_TOKENS_TABLE missing"),
        ):
            response = self._invoke(
                {
                    "httpMethod": "GET",
                    "path": "/calendar/demo-calendar-token.ics",
                    "pathParameters": {"token": "demo-calendar-token"},
                },
                env={"DEMO_MODE": "false"},
            )

        self.assertEqual(response["statusCode"], 500)
        self.assertIn("CALENDAR_TOKENS_TABLE", json.loads(response["body"])["error"])

    def test_calendar_token_create_accepts_claims_sub_principal(self) -> None:
        store = _MemoryCalendarTokenStore()
        event = {
            "httpMethod": "POST",
            "path": "/calendar/token",
            "headers": {"host": "api.example.test", "x-forwarded-proto": "https"},
            "requestContext": {
                "stage": "dev",
                "authorizer": {"claims": {"sub": "claims-user"}},
            },
        }

        with patch("backend.runtime._calendar_token_store", return_value=store):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 201)
        body = json.loads(response["body"])
        record = store.get(body["token"])
        self.assertIsNotNone(record)
        if record is None:
            self.fail("Expected token to be stored")
        self.assertEqual(record.user_id, "claims-user")

    def test_calendar_token_create_accepts_iam_identity_user_arn(self) -> None:
        store = _MemoryCalendarTokenStore()
        event = {
            "httpMethod": "POST",
            "path": "/calendar/token",
            "headers": {"host": "api.example.test", "x-forwarded-proto": "https"},
            "requestContext": {
                "stage": "dev",
                "identity": {"userArn": "arn:aws:iam::123456789012:user/demo"},
            },
        }

        with patch("backend.runtime._calendar_token_store", return_value=store):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 201)
        body = json.loads(response["body"])
        record = store.get(body["token"])
        self.assertIsNotNone(record)
        if record is None:
            self.fail("Expected token to be stored")
        self.assertEqual(record.user_id, "arn:aws:iam::123456789012:user/demo")

    def test_uploads_route_delegates_to_uploads_handler(self) -> None:
        event = {"httpMethod": "POST", "path": "/uploads", "body": "{}"}
        delegated_response = {"statusCode": 200, "body": "{}", "headers": {"Content-Type": "application/json"}}

        with patch("backend.runtime.uploads.lambda_handler", return_value=delegated_response) as handler:
            response = self._invoke(event)

        self.assertEqual(response, delegated_response)
        handler.assert_called_once_with(event, None)


if __name__ == "__main__":
    unittest.main()
