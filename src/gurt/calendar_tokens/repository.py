"""Persistence boundaries for calendar token storage."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from .model import CalendarTokenRecord


@runtime_checkable
class CalendarTokenStore(Protocol):
    """Storage interface for calendar token records."""

    def save(self, record: CalendarTokenRecord) -> None:
        """Persist a token record."""

    def get(self, token: str) -> CalendarTokenRecord | None:
        """Lookup a token record by token value."""


class DynamoDbCalendarTokenStore:
    """DynamoDB adapter that stores token records in a table keyed by token."""

    def __init__(self, table: Any) -> None:
        self._table = table

    def save(self, record: CalendarTokenRecord) -> None:
        self._table.put_item(Item=record.to_item())

    def get(self, token: str) -> CalendarTokenRecord | None:
        response = self._table.get_item(Key={"token": token})
        item = response.get("Item")
        if item is None:
            return None
        return CalendarTokenRecord.from_item(item)

    def revoke(self, token: str, *, revoked_at: str | None = None) -> CalendarTokenRecord | None:
        """Revoke an existing token if present and return updated record."""
        record = self.get(token)
        if record is None:
            return None

        revoked = record.revoke(revoked_at=revoked_at)
        self.save(revoked)
        return revoked

