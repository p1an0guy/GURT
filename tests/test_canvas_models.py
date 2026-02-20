"""Unit tests for Canvas contract models and DynamoDB mapping."""

from __future__ import annotations

import unittest

from studybuddy.models.canvas import (
    ATTR_GSI1_PK,
    ATTR_GSI1_SK,
    ATTR_GSI2_PK,
    ATTR_GSI2_SK,
    ATTR_PK,
    ATTR_SK,
    CanvasItem,
    Course,
    ModelValidationError,
    course_partition_key,
    course_sort_key,
    item_partition_key,
    item_sort_key,
)


class CourseModelTests(unittest.TestCase):
    def test_course_round_trip_api_payload(self) -> None:
        payload = {
            "id": "course-psych-101",
            "name": "PSYCH 101",
            "term": "Fall 2026",
            "color": "#3366FF",
        }
        model = Course.from_api_dict(payload)
        self.assertEqual(model.to_api_dict(), payload)

    def test_course_rejects_unknown_contract_fields(self) -> None:
        payload = {
            "id": "course-psych-101",
            "name": "PSYCH 101",
            "term": "Fall 2026",
            "color": "#3366FF",
            "canvasUrl": "https://canvas.example/courses/1",
        }
        with self.assertRaises(ModelValidationError):
            Course.from_api_dict(payload)

    def test_course_rejects_invalid_color(self) -> None:
        with self.assertRaises(ModelValidationError):
            Course(id="course-psych-101", name="PSYCH 101", term="Fall 2026", color="#33GGFF")

    def test_course_dynamodb_mapping(self) -> None:
        model = Course(id="course-psych-101", name="PSYCH 101", term="Fall 2026", color="#3366FF")
        record = model.to_dynamodb_item(
            user_id="demo-user",
            updated_at="2026-09-01T10:15:00Z",
        )

        self.assertEqual(record[ATTR_PK], course_partition_key("demo-user"))
        self.assertEqual(record[ATTR_SK], course_sort_key("course-psych-101"))
        self.assertTrue(record[ATTR_GSI1_SK].startswith("COURSE_NAME#psych 101#COURSE#"))
        self.assertEqual(record[ATTR_GSI1_PK], course_partition_key("demo-user"))
        self.assertEqual(
            Course.from_dynamodb_item(record, expected_user_id="demo-user").to_api_dict(),
            model.to_api_dict(),
        )

    def test_course_from_dynamodb_item_rejects_partition_key_mismatch(self) -> None:
        model = Course(id="course-psych-101", name="PSYCH 101", term="Fall 2026", color="#3366FF")
        record = model.to_dynamodb_item(
            user_id="demo-user",
            updated_at="2026-09-01T10:15:00Z",
        )
        with self.assertRaises(ModelValidationError):
            Course.from_dynamodb_item(record, expected_user_id="other-user")


class CanvasItemModelTests(unittest.TestCase):
    def test_canvas_item_round_trip_api_payload(self) -> None:
        payload = {
            "id": "item-exam-1",
            "courseId": "course-psych-101",
            "title": "Midterm Exam",
            "itemType": "exam",
            "dueAt": "2026-10-15T17:00:00Z",
            "pointsPossible": 100,
        }
        model = CanvasItem.from_api_dict(payload)
        self.assertEqual(model.to_api_dict(), payload)

    def test_canvas_item_rejects_unknown_fields(self) -> None:
        payload = {
            "id": "item-exam-1",
            "courseId": "course-psych-101",
            "title": "Midterm Exam",
            "itemType": "exam",
            "dueAt": "2026-10-15T17:00:00Z",
            "pointsPossible": 100,
            "source": "canvas",
        }
        with self.assertRaises(ModelValidationError):
            CanvasItem.from_api_dict(payload)

    def test_canvas_item_rejects_invalid_item_type(self) -> None:
        with self.assertRaises(ModelValidationError):
            CanvasItem(
                id="item-exam-1",
                course_id="course-psych-101",
                title="Midterm Exam",
                item_type="event",
                due_at="2026-10-15T17:00:00Z",
                points_possible=100,
            )

    def test_canvas_item_rejects_invalid_due_date(self) -> None:
        with self.assertRaises(ModelValidationError):
            CanvasItem(
                id="item-exam-1",
                course_id="course-psych-101",
                title="Midterm Exam",
                item_type="exam",
                due_at="2026-10-15T17:00:00+00:00",
                points_possible=100,
            )

    def test_canvas_item_rejects_negative_points(self) -> None:
        with self.assertRaises(ModelValidationError):
            CanvasItem(
                id="item-exam-1",
                course_id="course-psych-101",
                title="Midterm Exam",
                item_type="exam",
                due_at="2026-10-15T17:00:00Z",
                points_possible=-1,
            )

    def test_canvas_item_dynamodb_mapping(self) -> None:
        model = CanvasItem(
            id="item-exam-1",
            course_id="course-psych-101",
            title="Midterm Exam",
            item_type="exam",
            due_at="2026-10-15T17:00:00Z",
            points_possible=100,
        )
        record = model.to_dynamodb_item(
            user_id="demo-user",
            updated_at="2026-09-01T10:15:00Z",
        )

        self.assertEqual(record[ATTR_PK], item_partition_key("demo-user", "course-psych-101"))
        self.assertEqual(record[ATTR_SK], item_sort_key("item-exam-1"))
        self.assertTrue(record[ATTR_GSI1_SK].startswith("DUE#2026-10-15T17:00:00Z#ITEM#"))
        self.assertEqual(record[ATTR_GSI1_PK], item_partition_key("demo-user", "course-psych-101"))
        self.assertTrue(record[ATTR_GSI2_SK].startswith("DUE#2026-10-15T17:00:00Z#COURSE#"))
        self.assertEqual(record[ATTR_GSI2_PK], course_partition_key("demo-user"))
        self.assertEqual(
            CanvasItem.from_dynamodb_item(
                record,
                expected_user_id="demo-user",
                expected_course_id="course-psych-101",
            ).to_api_dict(),
            model.to_api_dict(),
        )

    def test_canvas_item_from_dynamodb_item_rejects_user_key_mismatch(self) -> None:
        model = CanvasItem(
            id="item-exam-1",
            course_id="course-psych-101",
            title="Midterm Exam",
            item_type="exam",
            due_at="2026-10-15T17:00:00Z",
            points_possible=100,
        )
        record = model.to_dynamodb_item(
            user_id="demo-user",
            updated_at="2026-09-01T10:15:00Z",
        )
        with self.assertRaises(ModelValidationError):
            CanvasItem.from_dynamodb_item(
                record,
                expected_user_id="other-user",
                expected_course_id="course-psych-101",
            )

    def test_canvas_item_from_dynamodb_item_rejects_course_key_mismatch(self) -> None:
        model = CanvasItem(
            id="item-exam-1",
            course_id="course-psych-101",
            title="Midterm Exam",
            item_type="exam",
            due_at="2026-10-15T17:00:00Z",
            points_possible=100,
        )
        record = model.to_dynamodb_item(
            user_id="demo-user",
            updated_at="2026-09-01T10:15:00Z",
        )
        with self.assertRaises(ModelValidationError):
            CanvasItem.from_dynamodb_item(
                record,
                expected_user_id="demo-user",
                expected_course_id="course-bio-220",
            )


if __name__ == "__main__":
    unittest.main()
