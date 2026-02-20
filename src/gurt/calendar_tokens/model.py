"""Domain model for calendar token persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re
from typing import Any, Mapping

_RFC3339_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def utc_now_rfc3339() -> str:
    """Return the current UTC timestamp in RFC3339 form with trailing Z."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _is_rfc3339_utc(value: str) -> bool:
    return bool(_RFC3339_UTC_RE.match(value))


def _parse_rfc3339_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass(frozen=True)
class CalendarTokenRecord:
    """Stored token that maps a private calendar token to a user."""

    token: str
    user_id: str
    created_at: str
    updated_at: str
    revoked: bool = False
    revoked_at: str | None = None

    def __post_init__(self) -> None:
        self._validate_non_empty("token", self.token)
        self._validate_non_empty("user_id", self.user_id)
        self._validate_timestamp("created_at", self.created_at)
        self._validate_timestamp("updated_at", self.updated_at)

        if self.revoked and not self.revoked_at:
            raise ValueError("revoked_at is required when revoked=True")
        if not self.revoked and self.revoked_at is not None:
            raise ValueError("revoked_at must be omitted when revoked=False")
        if self.revoked_at is not None:
            self._validate_timestamp("revoked_at", self.revoked_at)

        created = _parse_rfc3339_utc(self.created_at)
        updated = _parse_rfc3339_utc(self.updated_at)
        if updated < created:
            raise ValueError("updated_at must be >= created_at")

        if self.revoked_at is not None:
            revoked = _parse_rfc3339_utc(self.revoked_at)
            if revoked < created:
                raise ValueError("revoked_at must be >= created_at")
            if revoked < updated:
                raise ValueError("revoked_at must be >= updated_at")

    @staticmethod
    def _validate_non_empty(field_name: str, value: str) -> None:
        if not isinstance(value, str):
            raise ValueError(f"{field_name} must be a string")
        if not value.strip():
            raise ValueError(f"{field_name} must not be empty")

    @staticmethod
    def _validate_timestamp(field_name: str, value: str) -> None:
        if not isinstance(value, str):
            raise ValueError(f"{field_name} must be a string")
        if not _is_rfc3339_utc(value):
            raise ValueError(f"{field_name} must be RFC3339 UTC with trailing Z")

    @classmethod
    def mint(
        cls,
        *,
        token: str,
        user_id: str,
        created_at: str | None = None,
    ) -> "CalendarTokenRecord":
        """Construct a newly minted token record."""
        now = created_at or utc_now_rfc3339()
        return cls(
            token=token,
            user_id=user_id,
            created_at=now,
            updated_at=now,
            revoked=False,
            revoked_at=None,
        )

    def revoke(self, *, revoked_at: str | None = None) -> "CalendarTokenRecord":
        """Return a new record marked as revoked."""
        revoked_ts = revoked_at or utc_now_rfc3339()
        return CalendarTokenRecord(
            token=self.token,
            user_id=self.user_id,
            created_at=self.created_at,
            updated_at=revoked_ts,
            revoked=True,
            revoked_at=revoked_ts,
        )

    def to_item(self) -> dict[str, Any]:
        """Serialize to a DynamoDB-style item dictionary."""
        item: dict[str, Any] = {
            "token": self.token,
            "userId": self.user_id,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "revoked": self.revoked,
        }
        if self.revoked_at is not None:
            item["revokedAt"] = self.revoked_at
        return item

    @classmethod
    def from_item(cls, item: Mapping[str, Any]) -> "CalendarTokenRecord":
        """Deserialize from a DynamoDB item dictionary."""
        token = item.get("token")
        user_id = item.get("userId")
        created_at = item.get("createdAt")
        updated_at = item.get("updatedAt")
        revoked = item.get("revoked", False)
        revoked_at = item.get("revokedAt")

        if not isinstance(revoked, bool):
            raise ValueError("revoked must be a boolean")

        return cls(
            token=token,
            user_id=user_id,
            created_at=created_at,
            updated_at=updated_at,
            revoked=revoked,
            revoked_at=revoked_at,
        )

