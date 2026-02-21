"""Canvas course and item domain models with DynamoDB mapping helpers."""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from datetime import datetime
from typing import Any, Mapping

ITEM_TYPES = frozenset(("assignment", "exam", "quiz"))
HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")

ATTR_PK = "pk"
ATTR_SK = "sk"
ATTR_ENTITY_TYPE = "entityType"
ATTR_UPDATED_AT = "updatedAt"
ATTR_GSI1_PK = "gsi1pk"
ATTR_GSI1_SK = "gsi1sk"
ATTR_GSI2_PK = "gsi2pk"
ATTR_GSI2_SK = "gsi2sk"

ENTITY_COURSE = "CanvasCourse"
ENTITY_ITEM = "CanvasItem"


class ModelValidationError(ValueError):
    """Raised when model payloads or records fail validation."""


def _validate_required_exact_keys(payload: Mapping[str, Any], required: set[str], label: str) -> None:
    """Validate exact contract keys for contract-facing payloads."""
    missing = sorted(required - set(payload.keys()))
    if missing:
        raise ModelValidationError(f"{label}: missing required field(s): {missing}")

    unknown = sorted(set(payload.keys()) - required)
    if unknown:
        raise ModelValidationError(f"{label}: unknown field(s): {unknown}")


def _validate_non_empty_string(value: Any, field_name: str) -> str:
    """Require non-empty strings for contract string fields."""
    if not isinstance(value, str):
        raise ModelValidationError(f"{field_name}: expected string")
    if not value:
        raise ModelValidationError(f"{field_name}: must not be empty")
    return value


def _validate_date_time(value: Any, field_name: str) -> str:
    """Require RFC3339 UTC timestamps with a trailing Z."""
    text = _validate_non_empty_string(value, field_name)
    try:
        datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise ModelValidationError(
            f"{field_name}: expected RFC3339 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)"
        ) from exc
    return text


def _validate_non_negative_number(value: Any, field_name: str) -> float | int | Decimal:
    """Require numeric values that are >= 0."""
    if not isinstance(value, (int, float, Decimal)) or isinstance(value, bool):
        raise ModelValidationError(f"{field_name}: expected number")
    if value < 0:
        raise ModelValidationError(f"{field_name}: must be >= 0")
    return value


def _to_dynamodb_number(value: float | int | Decimal) -> float | int | Decimal:
    """Convert floats to Decimal because boto3 DynamoDB does not accept float."""
    if isinstance(value, float):
        return Decimal(str(value))
    return value


def course_partition_key(user_id: str) -> str:
    """Shared partition key for all course rows for a user."""
    uid = _validate_non_empty_string(user_id, "userId")
    return f"USER#{uid}"


def course_sort_key(course_id: str) -> str:
    """Sort key for a course row."""
    cid = _validate_non_empty_string(course_id, "courseId")
    return f"COURSE#{cid}"


def item_partition_key(user_id: str, course_id: str) -> str:
    """Partition key for all canvas items under a user+course."""
    uid = _validate_non_empty_string(user_id, "userId")
    cid = _validate_non_empty_string(course_id, "courseId")
    return f"USER#{uid}#COURSE#{cid}"


def item_sort_key(item_id: str) -> str:
    """Stable sort key per item, independent from due date changes."""
    iid = _validate_non_empty_string(item_id, "itemId")
    return f"ITEM#{iid}"


def item_due_sort_key(due_at: str, item_id: str) -> str:
    """Due-date-sortable key for course-level upcoming item queries."""
    due = _validate_date_time(due_at, "dueAt")
    iid = _validate_non_empty_string(item_id, "itemId")
    return f"DUE#{due}#ITEM#{iid}"


def user_due_sort_key(due_at: str, course_id: str, item_id: str) -> str:
    """Due-date-sortable key for user-wide upcoming item queries."""
    due = _validate_date_time(due_at, "dueAt")
    cid = _validate_non_empty_string(course_id, "courseId")
    iid = _validate_non_empty_string(item_id, "itemId")
    return f"DUE#{due}#COURSE#{cid}#ITEM#{iid}"


@dataclass(frozen=True)
class Course:
    """Contract-aligned Course model."""

    id: str
    name: str
    term: str
    color: str

    def __post_init__(self) -> None:
        _validate_non_empty_string(self.id, "id")
        _validate_non_empty_string(self.name, "name")
        _validate_non_empty_string(self.term, "term")
        color = _validate_non_empty_string(self.color, "color")
        if HEX_COLOR_PATTERN.match(color) is None:
            raise ModelValidationError("color: expected #RRGGBB format")

    @classmethod
    def from_api_dict(cls, payload: Mapping[str, Any]) -> "Course":
        """Build model from API payload enforcing contract strictness."""
        required = {"id", "name", "term", "color"}
        _validate_required_exact_keys(payload, required, "Course")
        return cls(
            id=payload["id"],
            name=payload["name"],
            term=payload["term"],
            color=payload["color"],
        )

    def to_api_dict(self) -> dict[str, Any]:
        """Serialize model in exact contract field names."""
        return {
            "id": self.id,
            "name": self.name,
            "term": self.term,
            "color": self.color,
        }

    def to_dynamodb_item(self, user_id: str, updated_at: str) -> dict[str, Any]:
        """Serialize into DynamoDB attributes for course storage."""
        uid = _validate_non_empty_string(user_id, "userId")
        stamp = _validate_date_time(updated_at, "updatedAt")
        return {
            ATTR_PK: course_partition_key(uid),
            ATTR_SK: course_sort_key(self.id),
            ATTR_ENTITY_TYPE: ENTITY_COURSE,
            "userId": uid,
            "id": self.id,
            "name": self.name,
            "term": self.term,
            "color": self.color,
            ATTR_GSI1_PK: course_partition_key(uid),
            ATTR_GSI1_SK: f"COURSE_NAME#{self.name.lower()}#COURSE#{self.id}",
            ATTR_UPDATED_AT: stamp,
        }

    @classmethod
    def from_dynamodb_item(cls, item: Mapping[str, Any], expected_user_id: str | None = None) -> "Course":
        """Build model from DynamoDB attributes with optional key checks."""
        if expected_user_id is not None:
            expected_pk = course_partition_key(expected_user_id)
            if item.get(ATTR_PK) != expected_pk:
                raise ModelValidationError("Course DynamoDB record has unexpected partition key")
        return cls.from_api_dict(
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "term": item.get("term"),
                "color": item.get("color"),
            }
        )


@dataclass(frozen=True)
class CanvasItem:
    """Contract-aligned CanvasItem model."""

    id: str
    course_id: str
    title: str
    item_type: str
    due_at: str
    points_possible: float | int | Decimal

    def __post_init__(self) -> None:
        _validate_non_empty_string(self.id, "id")
        _validate_non_empty_string(self.course_id, "courseId")
        _validate_non_empty_string(self.title, "title")
        item_type = _validate_non_empty_string(self.item_type, "itemType")
        if item_type not in ITEM_TYPES:
            raise ModelValidationError(f"itemType: unsupported value '{item_type}'")
        _validate_date_time(self.due_at, "dueAt")
        _validate_non_negative_number(self.points_possible, "pointsPossible")

    @classmethod
    def from_api_dict(cls, payload: Mapping[str, Any]) -> "CanvasItem":
        """Build model from API payload enforcing contract strictness."""
        required = {"id", "courseId", "title", "itemType", "dueAt", "pointsPossible"}
        _validate_required_exact_keys(payload, required, "CanvasItem")
        return cls(
            id=payload["id"],
            course_id=payload["courseId"],
            title=payload["title"],
            item_type=payload["itemType"],
            due_at=payload["dueAt"],
            points_possible=payload["pointsPossible"],
        )

    def to_api_dict(self) -> dict[str, Any]:
        """Serialize model in exact contract field names."""
        return {
            "id": self.id,
            "courseId": self.course_id,
            "title": self.title,
            "itemType": self.item_type,
            "dueAt": self.due_at,
            "pointsPossible": self.points_possible,
        }

    def to_dynamodb_item(self, user_id: str, updated_at: str) -> dict[str, Any]:
        """Serialize into DynamoDB attributes for item storage."""
        uid = _validate_non_empty_string(user_id, "userId")
        stamp = _validate_date_time(updated_at, "updatedAt")
        return {
            ATTR_PK: item_partition_key(uid, self.course_id),
            ATTR_SK: item_sort_key(self.id),
            ATTR_ENTITY_TYPE: ENTITY_ITEM,
            "userId": uid,
            "id": self.id,
            "courseId": self.course_id,
            "title": self.title,
            "itemType": self.item_type,
            "dueAt": self.due_at,
            "pointsPossible": _to_dynamodb_number(self.points_possible),
            ATTR_GSI1_PK: item_partition_key(uid, self.course_id),
            ATTR_GSI1_SK: item_due_sort_key(self.due_at, self.id),
            ATTR_GSI2_PK: course_partition_key(uid),
            ATTR_GSI2_SK: user_due_sort_key(self.due_at, self.course_id, self.id),
            ATTR_UPDATED_AT: stamp,
        }

    @classmethod
    def from_dynamodb_item(
        cls,
        item: Mapping[str, Any],
        expected_user_id: str | None = None,
        expected_course_id: str | None = None,
    ) -> "CanvasItem":
        """Build model from DynamoDB attributes with optional key checks."""
        if expected_user_id is not None and expected_course_id is not None:
            expected_pk = item_partition_key(expected_user_id, expected_course_id)
            if item.get(ATTR_PK) != expected_pk:
                raise ModelValidationError("CanvasItem DynamoDB record has unexpected partition key")
        return cls.from_api_dict(
            {
                "id": item.get("id"),
                "courseId": item.get("courseId"),
                "title": item.get("title"),
                "itemType": item.get("itemType"),
                "dueAt": item.get("dueAt"),
                "pointsPossible": item.get("pointsPossible"),
            }
        )
