"""Unit tests for API runtime lambda routing and calendar token checks."""

from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.canvas_client import CanvasApiError
from gurt.calendar_tokens.model import CalendarTokenRecord
from backend.runtime import lambda_handler


class _MemoryCalendarTokenStore:
    def __init__(self) -> None:
        self.rows: dict[str, CalendarTokenRecord] = {}

    def save(self, record: CalendarTokenRecord) -> None:
        self.rows[record.token] = record

    def get(self, token: str) -> CalendarTokenRecord | None:
        return self.rows.get(token)


class _MemoryDocsTable:
    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}

    def put_item(self, Item: dict) -> None:  # noqa: N803 - boto3 shape
        self.rows[str(Item["docId"])] = Item

    def get_item(self, Key: dict) -> dict:  # noqa: N803 - boto3 shape
        row = self.rows.get(str(Key["docId"]))
        return {"Item": row} if row is not None else {}


class _MemoryCardsTable:
    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}

    def put_item(self, Item: dict) -> None:  # noqa: N803 - boto3 shape
        self.rows[str(Item["cardId"])] = dict(Item)

    def get_item(self, Key: dict) -> dict:  # noqa: N803 - boto3 shape
        row = self.rows.get(str(Key["cardId"]))
        return {"Item": dict(row)} if row is not None else {}

    def scan(self, **kwargs: dict) -> dict:  # noqa: ARG002 - boto3 compatibility
        return {"Items": [dict(value) for value in self.rows.values()]}


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

    def test_health_route_includes_cors_headers(self) -> None:
        response = self._invoke({"httpMethod": "GET", "path": "/health"}, env={"DEMO_MODE": "false"})
        self.assertEqual(response["statusCode"], 200)
        headers = response.get("headers", {})
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")
        self.assertIn("POST", headers.get("Access-Control-Allow-Methods", ""))
        self.assertIn("Content-Type", headers.get("Access-Control-Allow-Headers", ""))

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

    def test_courses_route_requires_authenticated_principal_when_demo_mode_disabled(self) -> None:
        response = self._invoke(
            {"httpMethod": "GET", "path": "/courses"},
            env={"DEMO_MODE": "false"},
        )

        self.assertEqual(response["statusCode"], 401)
        self.assertIn("authenticated principal", json.loads(response["body"])["error"])

    def test_courses_route_returns_runtime_rows_when_available(self) -> None:
        event = {
            "httpMethod": "GET",
            "path": "/courses",
            "requestContext": {"authorizer": {"principalId": "demo-user"}},
        }

        with patch(
            "backend.runtime._query_canvas_courses_for_user",
            return_value=[
                {
                    "id": "170880",
                    "name": "POLS 112",
                    "term": "Spring 2026",
                    "color": "#3366FF",
                }
            ],
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        rows = json.loads(response["body"])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "170880")

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

    def test_course_items_returns_runtime_rows_when_available(self) -> None:
        event = {
            "httpMethod": "GET",
            "path": "/courses/170880/items",
            "pathParameters": {"courseId": "170880"},
            "requestContext": {"authorizer": {"principalId": "demo-user"}},
        }
        with patch(
            "backend.runtime._query_canvas_course_items_for_user",
            return_value=[
                {
                    "id": "assign-1",
                    "courseId": "170880",
                    "title": "Reading 1",
                    "itemType": "assignment",
                    "dueAt": "2026-09-05T23:59:00Z",
                    "pointsPossible": 10,
                }
            ],
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        rows = json.loads(response["body"])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "assign-1")
        self.assertEqual(rows[0]["courseId"], "170880")

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

    def test_study_today_uses_runtime_cards_when_present(self) -> None:
        cards_table = _MemoryCardsTable()
        cards_table.put_item(
            Item={
                "cardId": "card-runtime-1",
                "entityType": "Card",
                "courseId": "course-psych-101",
                "topicId": "topic-memory",
                "prompt": "Runtime prompt",
                "answer": "Runtime answer",
                "dueAt": "2026-09-01T09:00:00Z",
                "updatedAt": "2026-09-01T09:00:00Z",
            }
        )

        with patch("backend.runtime._cards_table", return_value=cards_table):
            response = self._invoke(
                {
                    "httpMethod": "GET",
                    "path": "/study/today",
                    "queryStringParameters": {"courseId": "course-psych-101"},
                },
                env={"DEMO_MODE": "false"},
            )

        self.assertEqual(response["statusCode"], 200)
        rows = json.loads(response["body"])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "card-runtime-1")
        self.assertEqual(rows[0]["prompt"], "Runtime prompt")

    def test_study_today_includes_near_exam_boosters_in_deterministic_order(self) -> None:
        now = datetime.now(timezone.utc)
        due_early = (now - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        due_late = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        not_due_early = (now + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        not_due_late = (now + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        exam_due = (now + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")

        cards_table = _MemoryCardsTable()
        for row in (
            {
                "cardId": "card-due-1",
                "entityType": "Card",
                "courseId": "course-psych-101",
                "topicId": "topic-high",
                "prompt": "Due 1",
                "answer": "A1",
                "dueAt": due_early,
                "fsrsState": {"stability": "9.0"},
            },
            {
                "cardId": "card-due-2",
                "entityType": "Card",
                "courseId": "course-psych-101",
                "topicId": "topic-high",
                "prompt": "Due 2",
                "answer": "A2",
                "dueAt": due_late,
                "fsrsState": {"stability": "9.0"},
            },
            {
                "cardId": "card-boost-1",
                "entityType": "Card",
                "courseId": "course-psych-101",
                "topicId": "topic-low",
                "prompt": "Boost 1",
                "answer": "B1",
                "dueAt": not_due_early,
                "fsrsState": {"stability": "1.0"},
            },
            {
                "cardId": "card-boost-2",
                "entityType": "Card",
                "courseId": "course-psych-101",
                "topicId": "topic-low",
                "prompt": "Boost 2",
                "answer": "B2",
                "dueAt": not_due_late,
                "fsrsState": {"stability": "1.0"},
            },
            {
                "cardId": "card-non-boost",
                "entityType": "Card",
                "courseId": "course-psych-101",
                "topicId": "topic-high",
                "prompt": "Non boost",
                "answer": "C1",
                "dueAt": not_due_early,
                "fsrsState": {"stability": "9.0"},
            },
        ):
            cards_table.put_item(Item=row)

        event = {
            "httpMethod": "GET",
            "path": "/study/today",
            "queryStringParameters": {"courseId": "course-psych-101"},
            "requestContext": {"authorizer": {"principalId": "demo-user"}},
        }
        with (
            patch("backend.runtime._cards_table", return_value=cards_table),
            patch(
                "backend.runtime._query_canvas_course_items_for_user",
                return_value=[
                    {
                        "id": "exam-near",
                        "courseId": "course-psych-101",
                        "title": "Midterm",
                        "itemType": "exam",
                        "dueAt": exam_due,
                        "pointsPossible": 100,
                    }
                ],
            ),
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        rows = json.loads(response["body"])
        self.assertEqual([row["id"] for row in rows], ["card-due-1", "card-due-2", "card-boost-1", "card-boost-2"])

    def test_study_today_does_not_include_boosters_when_exam_not_near(self) -> None:
        now = datetime.now(timezone.utc)
        due_at = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        not_due = (now + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        far_exam = (now + timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%SZ")

        cards_table = _MemoryCardsTable()
        cards_table.put_item(
            Item={
                "cardId": "card-due",
                "entityType": "Card",
                "courseId": "course-psych-101",
                "topicId": "topic-high",
                "prompt": "Due",
                "answer": "A1",
                "dueAt": due_at,
                "fsrsState": {"stability": "9.0"},
            }
        )
        cards_table.put_item(
            Item={
                "cardId": "card-possible-boost",
                "entityType": "Card",
                "courseId": "course-psych-101",
                "topicId": "topic-low",
                "prompt": "Low mastery",
                "answer": "B1",
                "dueAt": not_due,
                "fsrsState": {"stability": "1.0"},
            }
        )

        event = {
            "httpMethod": "GET",
            "path": "/study/today",
            "queryStringParameters": {"courseId": "course-psych-101"},
            "requestContext": {"authorizer": {"principalId": "demo-user"}},
        }
        with (
            patch("backend.runtime._cards_table", return_value=cards_table),
            patch(
                "backend.runtime._query_canvas_course_items_for_user",
                return_value=[
                    {
                        "id": "exam-far",
                        "courseId": "course-psych-101",
                        "title": "Final",
                        "itemType": "exam",
                        "dueAt": far_exam,
                        "pointsPossible": 100,
                    }
                ],
            ),
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        rows = json.loads(response["body"])
        self.assertEqual([row["id"] for row in rows], ["card-due"])

    def test_study_today_exam_id_precedence_over_fallback_exam(self) -> None:
        now = datetime.now(timezone.utc)
        far_exam = (now + timedelta(days=20)).strftime("%Y-%m-%dT%H:%M:%SZ")
        near_exam = (now + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        not_due = (now + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

        cards_table = _MemoryCardsTable()
        cards_table.put_item(
            Item={
                "cardId": "card-low-1",
                "entityType": "Card",
                "courseId": "course-psych-101",
                "topicId": "topic-low",
                "prompt": "Low mastery 1",
                "answer": "A1",
                "dueAt": not_due,
                "fsrsState": {"stability": "1.0"},
            }
        )
        cards_table.put_item(
            Item={
                "cardId": "card-low-2",
                "entityType": "Card",
                "courseId": "course-psych-101",
                "topicId": "topic-low",
                "prompt": "Low mastery 2",
                "answer": "A2",
                "dueAt": not_due,
                "fsrsState": {"stability": "1.0"},
            }
        )

        event = {
            "httpMethod": "GET",
            "path": "/study/today",
            "queryStringParameters": {"courseId": "course-psych-101", "examId": "exam-far"},
            "requestContext": {"authorizer": {"principalId": "demo-user"}},
        }
        with (
            patch("backend.runtime._cards_table", return_value=cards_table),
            patch(
                "backend.runtime._query_canvas_course_items_for_user",
                return_value=[
                    {
                        "id": "exam-near",
                        "courseId": "course-psych-101",
                        "title": "Quiz",
                        "itemType": "exam",
                        "dueAt": near_exam,
                        "pointsPossible": 10,
                    },
                    {
                        "id": "exam-far",
                        "courseId": "course-psych-101",
                        "title": "Final",
                        "itemType": "exam",
                        "dueAt": far_exam,
                        "pointsPossible": 100,
                    },
                ],
            ),
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        rows = json.loads(response["body"])
        # No due cards and selected exam is not near, so behavior remains fallback-first selection.
        self.assertEqual([row["id"] for row in rows], ["card-low-1", "card-low-2"])

    def test_study_today_cap_and_order_are_deterministic(self) -> None:
        now = datetime.now(timezone.utc)
        due_at = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        cards_table = _MemoryCardsTable()
        for index in range(70):
            cards_table.put_item(
                Item={
                    "cardId": f"card-{index:03d}",
                    "entityType": "Card",
                    "courseId": "course-psych-101",
                    "topicId": "topic-memory",
                    "prompt": f"Prompt {index}",
                    "answer": f"Answer {index}",
                    "dueAt": due_at,
                    "fsrsState": {"stability": "8.0"},
                }
            )

        event = {
            "httpMethod": "GET",
            "path": "/study/today",
            "queryStringParameters": {"courseId": "course-psych-101"},
        }
        with patch("backend.runtime._cards_table", return_value=cards_table):
            first_response = self._invoke(event, env={"DEMO_MODE": "false"})
            second_response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(first_response["statusCode"], 200)
        self.assertEqual(second_response["statusCode"], 200)
        first_rows = json.loads(first_response["body"])
        second_rows = json.loads(second_response["body"])
        self.assertEqual(len(first_rows), 50)
        self.assertEqual([row["id"] for row in first_rows], [row["id"] for row in second_rows])
        self.assertEqual([row["id"] for row in first_rows], [f"card-{index:03d}" for index in range(50)])

    def test_study_review_updates_runtime_fsrs_state(self) -> None:
        cards_table = _MemoryCardsTable()
        cards_table.put_item(
            Item={
                "cardId": "card-runtime-1",
                "entityType": "Card",
                "courseId": "course-psych-101",
                "topicId": "topic-memory",
                "prompt": "Runtime prompt",
                "answer": "Runtime answer",
                "dueAt": "2026-09-01T09:00:00Z",
                "updatedAt": "2026-09-01T09:00:00Z",
            }
        )
        payload = {
            "cardId": "card-runtime-1",
            "courseId": "course-psych-101",
            "rating": 4,
            "reviewedAt": "2026-09-01T10:15:00Z",
        }

        with patch("backend.runtime._cards_table", return_value=cards_table):
            response = self._invoke(
                {
                    "httpMethod": "POST",
                    "path": "/study/review",
                    "body": json.dumps(payload),
                },
                env={"DEMO_MODE": "false"},
            )

        self.assertEqual(response["statusCode"], 200)
        updated_row = cards_table.rows["card-runtime-1"]
        self.assertIn("fsrsState", updated_row)
        fsrs_state = updated_row["fsrsState"]
        self.assertEqual(fsrs_state["lastReviewedAt"], "2026-09-01T10:15:00Z")
        self.assertEqual(updated_row["reviewCount"], 1)

    def test_study_mastery_uses_runtime_cards_when_present(self) -> None:
        cards_table = _MemoryCardsTable()
        cards_table.put_item(
            Item={
                "cardId": "card-runtime-1",
                "entityType": "Card",
                "courseId": "course-psych-101",
                "topicId": "topic-memory",
                "prompt": "Runtime prompt",
                "answer": "Runtime answer",
                "dueAt": "2000-01-01T09:00:00Z",
                "fsrsState": {
                    "dueAt": "2000-01-01T09:00:00Z",
                    "stability": "6.5",
                    "difficulty": "4.1",
                    "reps": 3,
                    "lapses": 0,
                    "lastReviewedAt": "2026-08-31T09:00:00Z",
                },
            }
        )

        with patch("backend.runtime._cards_table", return_value=cards_table):
            response = self._invoke(
                {
                    "httpMethod": "GET",
                    "path": "/study/mastery",
                    "queryStringParameters": {"courseId": "course-psych-101"},
                },
                env={"DEMO_MODE": "false"},
            )

        self.assertEqual(response["statusCode"], 200)
        rows = json.loads(response["body"])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["topicId"], "topic-memory")
        self.assertEqual(rows[0]["dueCards"], 1)
        self.assertGreater(rows[0]["masteryLevel"], 0.0)

    def test_calendar_token_create_uses_demo_user_when_principal_is_missing_in_demo_mode(self) -> None:
        store = _MemoryCalendarTokenStore()
        with patch("backend.runtime._calendar_token_store", return_value=store):
            response = self._invoke(
                {"httpMethod": "POST", "path": "/calendar/token"},
                env={"DEMO_MODE": "true", "DEMO_USER_ID": "demo-fallback-user"},
            )

        self.assertEqual(response["statusCode"], 201)
        body = json.loads(response["body"])
        record = store.get(body["token"])
        self.assertIsNotNone(record)
        if record is None:
            self.fail("Expected token to be stored")
        self.assertEqual(record.user_id, "demo-fallback-user")

    def test_calendar_token_create_requires_authenticated_principal_when_demo_mode_disabled(self) -> None:
        response = self._invoke(
            {"httpMethod": "POST", "path": "/calendar/token"},
            env={"DEMO_MODE": "false"},
        )

        self.assertEqual(response["statusCode"], 401)
        self.assertIn("authenticated principal", json.loads(response["body"])["error"])

    def test_canvas_connect_uses_demo_user_when_principal_is_missing_in_demo_mode(self) -> None:
        event = {
            "httpMethod": "POST",
            "path": "/canvas/connect",
            "body": json.dumps({"canvasBaseUrl": "https://canvas.example.edu", "accessToken": "x"}),
        }

        with patch("backend.runtime._upsert_canvas_connection") as upsert:
            response = self._invoke(event, env={"DEMO_MODE": "true", "DEMO_USER_ID": "demo-fallback-user"})

        self.assertEqual(response["statusCode"], 200)
        call_kwargs = upsert.call_args.kwargs
        self.assertEqual(call_kwargs["user_id"], "demo-fallback-user")

    def test_canvas_connect_requires_authenticated_principal_when_demo_mode_disabled(self) -> None:
        response = self._invoke(
            {
                "httpMethod": "POST",
                "path": "/canvas/connect",
                "body": json.dumps({"canvasBaseUrl": "https://canvas.example.edu", "accessToken": "x"}),
            },
            env={"DEMO_MODE": "false"},
        )

        self.assertEqual(response["statusCode"], 401)
        self.assertIn("authenticated principal", json.loads(response["body"])["error"])

    def test_canvas_connect_persists_connection(self) -> None:
        event = {
            "httpMethod": "POST",
            "path": "/canvas/connect",
            "body": json.dumps({"canvasBaseUrl": "https://canvas.example.edu", "accessToken": "secret-token"}),
            "requestContext": {"authorizer": {"principalId": "demo-user"}},
        }

        with patch("backend.runtime._upsert_canvas_connection") as upsert:
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["connected"], True)
        upsert.assert_called_once()
        call_kwargs = upsert.call_args.kwargs
        self.assertEqual(call_kwargs["user_id"], "demo-user")
        self.assertEqual(call_kwargs["canvas_base_url"], "https://canvas.example.edu")
        self.assertEqual(call_kwargs["access_token"], "secret-token")

    def test_canvas_sync_requires_existing_connection(self) -> None:
        event = {
            "httpMethod": "POST",
            "path": "/canvas/sync",
            "requestContext": {"authorizer": {"principalId": "demo-user"}},
        }

        with patch("backend.runtime._read_canvas_connection", return_value=None):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 400)
        self.assertIn("canvas connection not found", json.loads(response["body"])["error"])

    def test_canvas_sync_upserts_rows_and_returns_failed_course_ids(self) -> None:
        event = {
            "httpMethod": "POST",
            "path": "/canvas/sync",
            "requestContext": {"authorizer": {"principalId": "demo-user"}},
        }

        with (
            patch(
                "backend.runtime._read_canvas_connection",
                return_value={"userId": "demo-user", "canvasBaseUrl": "https://canvas.example.edu", "accessToken": "x"},
            ),
            patch(
                "backend.runtime._sync_canvas_assignments_for_user",
                return_value=(2, 3, ["42"]),
            ) as sync_rows,
            patch(
                "backend.runtime._sync_canvas_materials_for_user",
                return_value=(4, 4, ["99"]),
            ) as sync_materials,
            patch(
                "backend.runtime._start_knowledge_base_ingestion",
                return_value=(True, "ingest-job-1", ""),
            ),
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["synced"], True)
        self.assertEqual(body["coursesUpserted"], 2)
        self.assertEqual(body["itemsUpserted"], 3)
        self.assertEqual(body["materialsUpserted"], 4)
        self.assertEqual(body["materialsMirrored"], 4)
        self.assertEqual(body["knowledgeBaseIngestionStarted"], True)
        self.assertEqual(body["knowledgeBaseIngestionJobId"], "ingest-job-1")
        self.assertEqual(body["knowledgeBaseIngestionError"], "")
        self.assertEqual(body["failedCourseIds"], ["42", "99"])
        sync_rows.assert_called_once()
        sync_materials.assert_called_once()

    def test_canvas_sync_returns_502_when_canvas_fetch_fails(self) -> None:
        event = {
            "httpMethod": "POST",
            "path": "/canvas/sync",
            "requestContext": {"authorizer": {"principalId": "demo-user"}},
        }

        with (
            patch(
                "backend.runtime._read_canvas_connection",
                return_value={"userId": "demo-user", "canvasBaseUrl": "https://canvas.example.edu", "accessToken": "x"},
            ),
            patch(
                "backend.runtime._sync_canvas_assignments_for_user",
                side_effect=CanvasApiError("canvas request failed"),
            ),
            patch(
                "backend.runtime._sync_canvas_materials_for_user",
                return_value=(0, 0, []),
            ),
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 502)

    def test_docs_ingest_start_returns_202_and_starts_step_function(self) -> None:
        docs_table = _MemoryDocsTable()
        sfn_client = unittest.mock.Mock()
        event = {
            "httpMethod": "POST",
            "path": "/docs/ingest",
            "body": json.dumps(
                {
                    "docId": "doc-123",
                    "courseId": "course-psych-101",
                    "key": "uploads/course-psych-101/doc-123/syllabus.pdf",
                }
            ),
        }

        with (
            patch("backend.runtime._docs_table", return_value=docs_table),
            patch("backend.runtime._stepfunctions_client", return_value=sfn_client),
            patch("backend.runtime._ingest_state_machine_arn", return_value="arn:aws:states:::stateMachine:test"),
        ):
            response = self._invoke(
                event,
                env={"DEMO_MODE": "false", "UPLOADS_BUCKET": "bucket-name"},
            )

        self.assertEqual(response["statusCode"], 202)
        body = json.loads(response["body"])
        self.assertEqual(body["status"], "RUNNING")
        self.assertTrue(body["jobId"].startswith("ingest-"))
        sfn_client.start_execution.assert_called_once()

    def test_docs_ingest_status_returns_404_for_missing_job(self) -> None:
        docs_table = _MemoryDocsTable()
        event = {"httpMethod": "GET", "path": "/docs/ingest/ingest-missing"}
        with patch("backend.runtime._docs_table", return_value=docs_table):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 404)

    def test_docs_ingest_status_returns_row(self) -> None:
        docs_table = _MemoryDocsTable()
        docs_table.put_item(
            Item={
                "docId": "ingest-abc",
                "entityType": "IngestJob",
                "jobId": "ingest-abc",
                "status": "FINISHED",
                "textLength": 321,
                "usedTextract": True,
                "updatedAt": "2026-09-01T10:15:00Z",
                "error": "",
                "kbIngestionJobId": "KBJOB123",
            }
        )
        event = {"httpMethod": "GET", "path": "/docs/ingest/ingest-abc"}
        with patch("backend.runtime._docs_table", return_value=docs_table):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["jobId"], "ingest-abc")
        self.assertEqual(body["status"], "FINISHED")
        self.assertEqual(body["textLength"], 321)
        self.assertEqual(body["kbIngestionJobId"], "KBJOB123")

    def test_generate_flashcards_returns_generated_cards(self) -> None:
        event = {
            "httpMethod": "POST",
            "path": "/generate/flashcards",
            "body": json.dumps({"courseId": "course-psych-101", "numCards": 5}),
        }

        with patch(
            "backend.runtime.generate_flashcards",
            return_value=[
                {
                    "id": "card-1",
                    "courseId": "course-psych-101",
                    "topicId": "topic-memory",
                    "prompt": "What is retrieval practice?",
                    "answer": "Actively recalling information from memory.",
                }
            ],
        ) as generate_cards:
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["id"], "card-1")
        generate_cards.assert_called_once_with(course_id="course-psych-101", num_cards=5)

    def test_generate_flashcards_persists_runtime_cards_when_cards_table_exists(self) -> None:
        cards_table = _MemoryCardsTable()
        event = {
            "httpMethod": "POST",
            "path": "/generate/flashcards",
            "body": json.dumps({"courseId": "course-psych-101", "numCards": 2}),
        }

        with (
            patch(
                "backend.runtime.generate_flashcards",
                return_value=[
                    {
                        "id": "card-1",
                        "courseId": "course-psych-101",
                        "topicId": "topic-memory",
                        "prompt": "What is retrieval practice?",
                        "answer": "Actively recalling information from memory.",
                    },
                    {
                        "id": "card-2",
                        "courseId": "course-psych-101",
                        "topicId": "topic-conditioning",
                        "prompt": "What is extinction?",
                        "answer": "Weakening of a conditioned response.",
                    },
                ],
            ),
            patch("backend.runtime._cards_table", return_value=cards_table),
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        self.assertIn("card-1", cards_table.rows)
        self.assertIn("card-2", cards_table.rows)
        self.assertEqual(cards_table.rows["card-1"]["entityType"], "Card")
        self.assertEqual(cards_table.rows["card-1"]["courseId"], "course-psych-101")

    def test_generate_flashcards_rejects_non_positive_num_cards(self) -> None:
        event = {
            "httpMethod": "POST",
            "path": "/generate/flashcards",
            "body": json.dumps({"courseId": "course-psych-101", "numCards": 0}),
        }

        response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 400)
        self.assertIn("numCards must be >= 1", json.loads(response["body"])["error"])

    def test_generate_practice_exam_returns_generated_exam(self) -> None:
        event = {
            "httpMethod": "POST",
            "path": "/generate/practice-exam",
            "body": json.dumps({"courseId": "course-psych-101", "numQuestions": 10}),
        }

        with patch(
            "backend.runtime.generate_practice_exam",
            return_value={
                "courseId": "course-psych-101",
                "generatedAt": "2026-09-02T08:30:00Z",
                "questions": [
                    {
                        "id": "q-1",
                        "prompt": "Which process transfers information to long-term memory?",
                        "choices": ["Encoding", "Recognition"],
                        "answerIndex": 0,
                    }
                ],
            },
        ) as generate_exam:
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["courseId"], "course-psych-101")
        self.assertEqual(len(body["questions"]), 1)
        generate_exam.assert_called_once_with(course_id="course-psych-101", num_questions=10)

    def test_chat_returns_answer_with_citations(self) -> None:
        event = {
            "httpMethod": "POST",
            "path": "/chat",
            "body": json.dumps(
                {
                    "courseId": "course-psych-101",
                    "question": "What is working memory?",
                }
            ),
        }

        with patch(
            "backend.runtime.chat_answer",
            return_value={
                "answer": "Working memory temporarily stores and manipulates information.",
                "citations": ["s3://bucket/doc.pdf#chunk-3"],
            },
        ) as chat_answer:
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertIn("answer", body)
        self.assertEqual(len(body["citations"]), 1)
        chat_answer.assert_called_once_with(
            course_id="course-psych-101",
            question="What is working memory?",
            canvas_context=None,
        )

    def test_chat_passes_canvas_context_in_demo_mode(self) -> None:
        event = {
            "httpMethod": "POST",
            "path": "/chat",
            "body": json.dumps(
                {
                    "courseId": "170880",
                    "question": "When is the midterm?",
                }
            ),
        }

        canvas_items = [
            {
                "id": "assign-1",
                "courseId": "170880",
                "title": "Midterm Exam",
                "itemType": "exam",
                "dueAt": "2026-10-15T17:00:00Z",
                "pointsPossible": 100,
            }
        ]

        with (
            patch(
                "backend.runtime._query_canvas_course_items_for_user",
                return_value=canvas_items,
            ) as query_items,
            patch(
                "backend.runtime.chat_answer",
                return_value={
                    "answer": "The midterm is on October 15.",
                    "citations": [],
                },
            ) as chat_mock,
        ):
            response = self._invoke(event, env={"DEMO_MODE": "true"})

        self.assertEqual(response["statusCode"], 200)
        query_items.assert_called_once_with(user_id="demo-user", course_id="170880")
        call_kwargs = chat_mock.call_args.kwargs
        self.assertIsNotNone(call_kwargs["canvas_context"])
        self.assertIn("Midterm Exam", call_kwargs["canvas_context"])

    def test_chat_proceeds_when_canvas_query_fails(self) -> None:
        event = {
            "httpMethod": "POST",
            "path": "/chat",
            "body": json.dumps(
                {
                    "courseId": "170880",
                    "question": "What is federalism?",
                }
            ),
        }

        with (
            patch(
                "backend.runtime._query_canvas_course_items_for_user",
                side_effect=RuntimeError("CANVAS_DATA_TABLE missing"),
            ),
            patch(
                "backend.runtime.chat_answer",
                return_value={
                    "answer": "Federalism divides powers.",
                    "citations": [],
                },
            ) as chat_mock,
        ):
            response = self._invoke(event, env={"DEMO_MODE": "true"})

        self.assertEqual(response["statusCode"], 200)
        call_kwargs = chat_mock.call_args.kwargs
        self.assertIsNone(call_kwargs["canvas_context"])

    def test_chat_returns_502_when_generation_fails(self) -> None:
        event = {
            "httpMethod": "POST",
            "path": "/chat",
            "body": json.dumps(
                {
                    "courseId": "course-psych-101",
                    "question": "What is working memory?",
                }
            ),
        }

        with patch("backend.runtime.chat_answer", side_effect=RuntimeError("downstream failed")):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 502)

    def test_scheduled_canvas_sync_processes_all_connections_and_continues_on_user_failures(self) -> None:
        event = {"source": "aws.events", "detail-type": "Scheduled Event"}

        with (
            patch(
                "backend.runtime._list_canvas_connections",
                return_value=[
                    {
                        "userId": "user-1",
                        "canvasBaseUrl": "https://canvas.calpoly.edu",
                        "accessToken": "token-1",
                    },
                    {
                        "userId": "user-2",
                        "canvasBaseUrl": "https://canvas.calpoly.edu",
                        "accessToken": "token-2",
                    },
                ],
            ),
            patch(
                "backend.runtime._sync_canvas_assignments_for_user",
                side_effect=[(2, 7, ["42"]), CanvasApiError("invalid token")],
            ),
            patch(
                "backend.runtime._sync_canvas_materials_for_user",
                return_value=(5, 5, []),
            ),
            patch(
                "backend.runtime._start_knowledge_base_ingestion",
                return_value=(True, "ingest-job-2", ""),
            ),
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["scheduled"], True)
        self.assertEqual(body["connectionsProcessed"], 2)
        self.assertEqual(body["usersSucceeded"], 1)
        self.assertEqual(body["usersFailed"], 1)
        self.assertEqual(body["coursesUpserted"], 2)
        self.assertEqual(body["itemsUpserted"], 7)
        self.assertEqual(body["materialsUpserted"], 5)
        self.assertEqual(body["materialsMirrored"], 5)
        self.assertEqual(body["knowledgeBaseIngestionStarted"], True)
        self.assertEqual(body["knowledgeBaseIngestionJobId"], "ingest-job-2")
        self.assertEqual(body["knowledgeBaseIngestionError"], "")
        self.assertEqual(body["failedCourseIdsByUser"]["user-1"], ["42"])
        self.assertIn("user-2", body["userErrors"])

    def test_scheduled_canvas_sync_handles_empty_connection_set(self) -> None:
        event = {"source": "aws.events", "detail-type": "Scheduled Event"}
        with patch("backend.runtime._list_canvas_connections", return_value=[]):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["connectionsProcessed"], 0)
        self.assertEqual(body["usersSucceeded"], 0)
        self.assertEqual(body["usersFailed"], 0)

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

    def test_calendar_route_defaults_zero_duration_events_to_60_minutes(self) -> None:
        store = _MemoryCalendarTokenStore()
        store.save(
            CalendarTokenRecord.mint(
                token="calendar-token-60m",
                user_id="demo-user",
                created_at="2026-09-01T10:15:00Z",
            )
        )

        event = {
            "httpMethod": "GET",
            "path": "/calendar/calendar-token-60m.ics",
            "pathParameters": {"token": "calendar-token-60m"},
        }

        with (
            patch("backend.runtime._calendar_token_store", return_value=store),
            patch(
                "backend.runtime._load_schedule_items_for_user",
                return_value=[
                    {
                        "id": "item-60m",
                        "courseId": "course-psych-101",
                        "title": "Zero Duration Exam",
                        "dueAt": "2026-10-15T17:00:00Z",
                    }
                ],
            ),
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        self.assertIn("DTSTART:20261015T170000Z", response["body"])
        self.assertIn("DTEND:20261015T180000Z", response["body"])

    def test_calendar_route_preserves_explicit_start_and_end_times(self) -> None:
        store = _MemoryCalendarTokenStore()
        store.save(
            CalendarTokenRecord.mint(
                token="calendar-token-explicit-window",
                user_id="demo-user",
                created_at="2026-09-01T10:15:00Z",
            )
        )

        event = {
            "httpMethod": "GET",
            "path": "/calendar/calendar-token-explicit-window.ics",
            "pathParameters": {"token": "calendar-token-explicit-window"},
        }

        with (
            patch("backend.runtime._calendar_token_store", return_value=store),
            patch(
                "backend.runtime._load_schedule_items_for_user",
                return_value=[
                    {
                        "id": "item-window",
                        "courseId": "course-psych-101",
                        "title": "Timed Exam",
                        "dueAt": "2026-10-15T17:00:00Z",
                        "startAt": "2026-10-15T17:00:00Z",
                        "endAt": "2026-10-15T19:00:00Z",
                    }
                ],
            ),
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        self.assertIn("DTSTART:20261015T170000Z", response["body"])
        self.assertIn("DTEND:20261015T190000Z", response["body"])

    def test_calendar_route_falls_back_to_due_at_when_optional_window_fields_are_invalid(self) -> None:
        store = _MemoryCalendarTokenStore()
        store.save(
            CalendarTokenRecord.mint(
                token="calendar-token-invalid-window",
                user_id="demo-user",
                created_at="2026-09-01T10:15:00Z",
            )
        )

        event = {
            "httpMethod": "GET",
            "path": "/calendar/calendar-token-invalid-window.ics",
            "pathParameters": {"token": "calendar-token-invalid-window"},
        }

        with (
            patch("backend.runtime._calendar_token_store", return_value=store),
            patch(
                "backend.runtime._load_schedule_items_for_user",
                return_value=[
                    {
                        "id": "item-invalid-window",
                        "courseId": "course-psych-101",
                        "title": "Exam With Bad Optional Times",
                        "dueAt": "2026-10-15T17:00:00Z",
                        "startAt": "not-a-time",
                        "endAt": "also-not-a-time",
                    }
                ],
            ),
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        self.assertIn("DTSTART:20261015T170000Z", response["body"])
        self.assertIn("DTEND:20261015T180000Z", response["body"])
    def test_calendar_route_skips_invalid_due_at_and_keeps_valid_events(self) -> None:
        store = _MemoryCalendarTokenStore()
        store.save(
            CalendarTokenRecord.mint(
                token="calendar-token-invalid-due-at",
                user_id="demo-user",
                created_at="2026-09-01T10:15:00Z",
            )
        )
        event = {
            "httpMethod": "GET",
            "path": "/calendar/calendar-token-invalid-due-at.ics",
            "pathParameters": {"token": "calendar-token-invalid-due-at"},
        }

        with (
            patch("backend.runtime._calendar_token_store", return_value=store),
            patch(
                "backend.runtime._load_schedule_items_for_user",
                return_value=[
                    {
                        "id": "item-invalid-due-at",
                        "courseId": "course-psych-101",
                        "title": "Invalid dueAt",
                        "dueAt": "not-a-date",
                    },
                    {
                        "id": "item-valid-due-at",
                        "courseId": "course-psych-101",
                        "title": "Valid dueAt",
                        "dueAt": "2026-10-15T17:00:00Z",
                    },
                ],
            ),
        ):
            response = self._invoke(event, env={"DEMO_MODE": "false"})

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(response["headers"]["Content-Type"], "text/calendar")
        self.assertIn("BEGIN:VCALENDAR", response["body"])
        self.assertIn("SUMMARY:Valid dueAt", response["body"])
        self.assertNotIn("SUMMARY:Invalid dueAt", response["body"])
        self.assertEqual(response["body"].count("BEGIN:VEVENT"), 1)

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

    def test_calendar_route_isolates_events_by_token_user(self) -> None:
        store = _MemoryCalendarTokenStore()
        store.save(
            CalendarTokenRecord.mint(
                token="token-user-a",
                user_id="user-a",
                created_at="2026-09-01T10:15:00Z",
            )
        )
        store.save(
            CalendarTokenRecord.mint(
                token="token-user-b",
                user_id="user-b",
                created_at="2026-09-01T10:15:00Z",
            )
        )

        def load_items_for_user(user_id: str) -> list[dict[str, str]]:
            if user_id == "user-a":
                return [
                    {
                        "id": "item-a-1",
                        "courseId": "course-a",
                        "title": "User A Midterm",
                        "dueAt": "2026-10-15T17:00:00Z",
                    }
                ]
            if user_id == "user-b":
                return [
                    {
                        "id": "item-b-1",
                        "courseId": "course-b",
                        "title": "User B Quiz",
                        "dueAt": "2026-10-16T17:00:00Z",
                    }
                ]
            return []

        with (
            patch("backend.runtime._calendar_token_store", return_value=store),
            patch("backend.runtime._load_schedule_items_for_user", side_effect=load_items_for_user) as load_items,
        ):
            response_a = self._invoke(
                {
                    "httpMethod": "GET",
                    "path": "/calendar/token-user-a.ics",
                    "pathParameters": {"token": "token-user-a"},
                },
                env={"DEMO_MODE": "false"},
            )
            response_b = self._invoke(
                {
                    "httpMethod": "GET",
                    "path": "/calendar/token-user-b.ics",
                    "pathParameters": {"token": "token-user-b"},
                },
                env={"DEMO_MODE": "false"},
            )

        self.assertEqual(response_a["statusCode"], 200)
        self.assertEqual(response_b["statusCode"], 200)
        self.assertIn("SUMMARY:User A Midterm", response_a["body"])
        self.assertNotIn("SUMMARY:User B Quiz", response_a["body"])
        self.assertIn("SUMMARY:User B Quiz", response_b["body"])
        self.assertNotIn("SUMMARY:User A Midterm", response_b["body"])
        self.assertEqual(load_items.call_args_list[0].args, ("user-a",))
        self.assertEqual(load_items.call_args_list[1].args, ("user-b",))

    def test_calendar_route_keeps_uid_stable_when_event_fields_change(self) -> None:
        store = _MemoryCalendarTokenStore()
        store.save(
            CalendarTokenRecord.mint(
                token="token-stable-uid",
                user_id="demo-user",
                created_at="2026-09-01T10:15:00Z",
            )
        )

        first_snapshot = [
            {
                "id": "item-123",
                "courseId": "course-psych-101",
                "title": "Midterm Exam",
                "dueAt": "2026-10-15T17:00:00Z",
            }
        ]
        second_snapshot = [
            {
                "id": "item-123",
                "courseId": "course-psych-101",
                "title": "Midterm Exam Updated",
                "dueAt": "2026-10-16T18:30:00Z",
            }
        ]

        with (
            patch("backend.runtime._calendar_token_store", return_value=store),
            patch("backend.runtime._load_schedule_items_for_user", side_effect=[first_snapshot, second_snapshot]),
        ):
            first_response = self._invoke(
                {
                    "httpMethod": "GET",
                    "path": "/calendar/token-stable-uid.ics",
                    "pathParameters": {"token": "token-stable-uid"},
                },
                env={"DEMO_MODE": "false"},
            )
            second_response = self._invoke(
                {
                    "httpMethod": "GET",
                    "path": "/calendar/token-stable-uid.ics",
                    "pathParameters": {"token": "token-stable-uid"},
                },
                env={"DEMO_MODE": "false"},
            )

        self.assertEqual(first_response["statusCode"], 200)
        self.assertEqual(second_response["statusCode"], 200)

        first_uid_line = next(
            line for line in first_response["body"].splitlines() if line.startswith("UID:")
        )
        second_uid_line = next(
            line for line in second_response["body"].splitlines() if line.startswith("UID:")
        )
        first_start_line = next(
            line for line in first_response["body"].splitlines() if line.startswith("DTSTART:")
        )
        second_start_line = next(
            line for line in second_response["body"].splitlines() if line.startswith("DTSTART:")
        )

        self.assertEqual(first_uid_line, second_uid_line)
        self.assertNotEqual(first_start_line, second_start_line)
        self.assertIn("SUMMARY:Midterm Exam Updated", second_response["body"])

    def test_calendar_route_uses_fixture_events_for_demo_user_when_schedule_is_empty_in_demo_mode(self) -> None:
        store = _MemoryCalendarTokenStore()
        store.save(
            CalendarTokenRecord.mint(
                token="token-demo-user",
                user_id="demo-user",
                created_at="2026-09-01T10:15:00Z",
            )
        )

        with (
            patch("backend.runtime._calendar_token_store", return_value=store),
            patch("backend.runtime._query_canvas_items_for_user", return_value=[]),
        ):
            response = self._invoke(
                {
                    "httpMethod": "GET",
                    "path": "/calendar/token-demo-user.ics",
                    "pathParameters": {"token": "token-demo-user"},
                },
                env={"DEMO_MODE": "true", "CALENDAR_FIXTURE_FALLBACK": "true"},
            )

        self.assertEqual(response["statusCode"], 200)
        self.assertIn("BEGIN:VEVENT", response["body"])

    def test_calendar_route_skips_fixture_fallback_for_non_demo_user_when_schedule_is_empty(self) -> None:
        store = _MemoryCalendarTokenStore()
        store.save(
            CalendarTokenRecord.mint(
                token="token-non-demo-user",
                user_id="arn:aws:iam::123456789012:user/demo",
                created_at="2026-09-01T10:15:00Z",
            )
        )

        with (
            patch("backend.runtime._calendar_token_store", return_value=store),
            patch("backend.runtime._query_canvas_items_for_user", return_value=[]),
        ):
            response = self._invoke(
                {
                    "httpMethod": "GET",
                    "path": "/calendar/token-non-demo-user.ics",
                    "pathParameters": {"token": "token-non-demo-user"},
                },
                env={"DEMO_MODE": "true", "CALENDAR_FIXTURE_FALLBACK": "true"},
            )

        self.assertEqual(response["statusCode"], 200)
        self.assertIn("BEGIN:VCALENDAR", response["body"])
        self.assertNotIn("BEGIN:VEVENT", response["body"])

    def test_calendar_route_skips_fixture_fallback_when_demo_mode_disabled_even_if_flag_is_enabled(self) -> None:
        store = _MemoryCalendarTokenStore()
        store.save(
            CalendarTokenRecord.mint(
                token="token-demo-disabled",
                user_id="arn:aws:iam::123456789012:user/demo",
                created_at="2026-09-01T10:15:00Z",
            )
        )

        with (
            patch("backend.runtime._calendar_token_store", return_value=store),
            patch("backend.runtime._query_canvas_items_for_user", return_value=[]),
        ):
            response = self._invoke(
                {
                    "httpMethod": "GET",
                    "path": "/calendar/token-demo-disabled.ics",
                    "pathParameters": {"token": "token-demo-disabled"},
                },
                env={"DEMO_MODE": "false", "CALENDAR_FIXTURE_FALLBACK": "true"},
            )

        self.assertEqual(response["statusCode"], 200)
        self.assertIn("BEGIN:VCALENDAR", response["body"])
        self.assertNotIn("BEGIN:VEVENT", response["body"])

    def test_calendar_route_skips_fixture_fallback_when_flag_is_disabled(self) -> None:
        store = _MemoryCalendarTokenStore()
        store.save(
            CalendarTokenRecord.mint(
                token="token-no-fallback",
                user_id="arn:aws:iam::123456789012:user/demo",
                created_at="2026-09-01T10:15:00Z",
            )
        )

        with (
            patch("backend.runtime._calendar_token_store", return_value=store),
            patch("backend.runtime._query_canvas_items_for_user", return_value=[]),
        ):
            response = self._invoke(
                {
                    "httpMethod": "GET",
                    "path": "/calendar/token-no-fallback.ics",
                    "pathParameters": {"token": "token-no-fallback"},
                },
                env={"DEMO_MODE": "false", "CALENDAR_FIXTURE_FALLBACK": "false"},
            )

        self.assertEqual(response["statusCode"], 200)
        self.assertIn("BEGIN:VCALENDAR", response["body"])
        self.assertNotIn("BEGIN:VEVENT", response["body"])

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
