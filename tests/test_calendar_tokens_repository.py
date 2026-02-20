"""Unit tests for DynamoDB calendar token storage adapter."""

from __future__ import annotations

import unittest

from gurt.calendar_tokens.model import CalendarTokenRecord
from gurt.calendar_tokens.repository import DynamoDbCalendarTokenStore


class _FakeDynamoTable:
    def __init__(self) -> None:
        self.items: dict[str, dict[str, object]] = {}

    def put_item(self, *, Item: dict[str, object]) -> None:
        token = Item["token"]
        if not isinstance(token, str):
            raise TypeError("token must be a string")
        self.items[token] = dict(Item)

    def get_item(self, *, Key: dict[str, str]) -> dict[str, dict[str, object]]:
        token = Key["token"]
        item = self.items.get(token)
        if item is None:
            return {}
        return {"Item": dict(item)}


class DynamoDbCalendarTokenStoreTests(unittest.TestCase):
    def test_save_and_get_roundtrip(self) -> None:
        table = _FakeDynamoTable()
        store = DynamoDbCalendarTokenStore(table)
        record = CalendarTokenRecord(
            token="token-abc",
            user_id="demo-user",
            created_at="2026-09-01T10:15:00Z",
            updated_at="2026-09-01T10:15:00Z",
        )

        store.save(record)
        fetched = store.get("token-abc")
        self.assertEqual(fetched, record)

    def test_get_returns_none_when_missing(self) -> None:
        table = _FakeDynamoTable()
        store = DynamoDbCalendarTokenStore(table)
        self.assertIsNone(store.get("missing"))

    def test_revoke_roundtrip_updates_and_persists_state(self) -> None:
        table = _FakeDynamoTable()
        store = DynamoDbCalendarTokenStore(table)
        record = CalendarTokenRecord(
            token="token-abc",
            user_id="demo-user",
            created_at="2026-09-01T10:15:00Z",
            updated_at="2026-09-01T10:15:00Z",
        )
        store.save(record)

        revoked = store.revoke("token-abc", revoked_at="2026-09-01T11:00:00Z")
        self.assertIsNotNone(revoked)
        if revoked is None:
            self.fail("Expected revoked record")
        self.assertTrue(revoked.revoked)
        self.assertEqual(revoked.updated_at, "2026-09-01T11:00:00Z")
        self.assertEqual(revoked.revoked_at, "2026-09-01T11:00:00Z")

        fetched = store.get("token-abc")
        self.assertEqual(fetched, revoked)

    def test_revoke_returns_none_when_missing(self) -> None:
        table = _FakeDynamoTable()
        store = DynamoDbCalendarTokenStore(table)
        self.assertIsNone(store.revoke("missing", revoked_at="2026-09-01T11:00:00Z"))


if __name__ == "__main__":
    unittest.main()
