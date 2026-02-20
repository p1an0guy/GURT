"""Unit tests for calendar token record validation and serialization."""

from __future__ import annotations

import unittest

from gurt.calendar_tokens.model import CalendarTokenRecord


class CalendarTokenRecordTests(unittest.TestCase):
    def test_serialization_round_trip(self) -> None:
        record = CalendarTokenRecord(
            token="token-abc",
            user_id="demo-user",
            created_at="2026-09-01T10:15:00Z",
            updated_at="2026-09-01T10:15:00Z",
            revoked=False,
            revoked_at=None,
        )

        serialized = record.to_item()
        self.assertEqual(serialized["token"], "token-abc")
        self.assertEqual(serialized["userId"], "demo-user")
        self.assertFalse(serialized["revoked"])
        self.assertNotIn("revokedAt", serialized)

        hydrated = CalendarTokenRecord.from_item(serialized)
        self.assertEqual(hydrated, record)

    def test_revoked_serialization_includes_revoked_at(self) -> None:
        revoked = CalendarTokenRecord(
            token="token-abc",
            user_id="demo-user",
            created_at="2026-09-01T10:15:00Z",
            updated_at="2026-09-01T12:15:00Z",
            revoked=True,
            revoked_at="2026-09-01T12:15:00Z",
        )

        serialized = revoked.to_item()
        self.assertTrue(serialized["revoked"])
        self.assertEqual(serialized["revokedAt"], "2026-09-01T12:15:00Z")
        self.assertEqual(CalendarTokenRecord.from_item(serialized), revoked)

    def test_revoked_requires_revoked_timestamp(self) -> None:
        with self.assertRaisesRegex(ValueError, "revoked_at is required"):
            CalendarTokenRecord(
                token="token-abc",
                user_id="demo-user",
                created_at="2026-09-01T10:15:00Z",
                updated_at="2026-09-01T10:15:00Z",
                revoked=True,
                revoked_at=None,
            )

    def test_non_revoked_cannot_set_revoked_timestamp(self) -> None:
        with self.assertRaisesRegex(ValueError, "revoked_at must be omitted"):
            CalendarTokenRecord(
                token="token-abc",
                user_id="demo-user",
                created_at="2026-09-01T10:15:00Z",
                updated_at="2026-09-01T10:15:00Z",
                revoked=False,
                revoked_at="2026-09-01T11:15:00Z",
            )

    def test_timestamp_must_have_trailing_z(self) -> None:
        with self.assertRaisesRegex(ValueError, "created_at must be RFC3339 UTC"):
            CalendarTokenRecord(
                token="token-abc",
                user_id="demo-user",
                created_at="2026-09-01T10:15:00+00:00",
                updated_at="2026-09-01T10:15:00Z",
            )

    def test_from_item_defaults_revoked_to_false(self) -> None:
        item = {
            "token": "token-abc",
            "userId": "demo-user",
            "createdAt": "2026-09-01T10:15:00Z",
            "updatedAt": "2026-09-01T10:15:00Z",
        }

        record = CalendarTokenRecord.from_item(item)
        self.assertFalse(record.revoked)
        self.assertIsNone(record.revoked_at)

    def test_revoke_updates_state(self) -> None:
        record = CalendarTokenRecord(
            token="token-abc",
            user_id="demo-user",
            created_at="2026-09-01T10:15:00Z",
            updated_at="2026-09-01T10:15:00Z",
        )

        revoked = record.revoke(revoked_at="2026-09-01T11:00:00Z")
        self.assertTrue(revoked.revoked)
        self.assertEqual(revoked.updated_at, "2026-09-01T11:00:00Z")
        self.assertEqual(revoked.revoked_at, "2026-09-01T11:00:00Z")


if __name__ == "__main__":
    unittest.main()

