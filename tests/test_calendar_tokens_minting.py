"""Unit tests for token minting path wiring."""

from __future__ import annotations

import unittest

from gurt.calendar_tokens.minting import (
    CalendarTokenMintingError,
    MintingConfig,
    TokenMintingPath,
    mint_calendar_token,
)
from gurt.calendar_tokens.model import CalendarTokenRecord


class _MemoryStore:
    def __init__(self) -> None:
        self.rows: list[CalendarTokenRecord] = []

    def save(self, record: CalendarTokenRecord) -> None:
        self.rows.append(record)

    def get(self, token: str) -> CalendarTokenRecord | None:
        for row in self.rows:
            if row.token == token:
                return row
        return None


class CalendarTokenMintingTests(unittest.TestCase):
    def test_from_env_defaults_to_endpoint_path(self) -> None:
        config = MintingConfig.from_env({})
        self.assertEqual(config.path, TokenMintingPath.ENDPOINT)
        self.assertIsNone(config.seeded_token)
        self.assertIsNone(config.seeded_user_id)

    def test_from_env_rejects_invalid_minting_path(self) -> None:
        with self.assertRaisesRegex(CalendarTokenMintingError, "must be 'endpoint' or 'env'"):
            MintingConfig.from_env({"CALENDAR_TOKEN_MINTING_PATH": "manual"})

    def test_from_env_reads_env_path_and_seed_values(self) -> None:
        config = MintingConfig.from_env(
            {
                "CALENDAR_TOKEN_MINTING_PATH": "ENV",
                "CALENDAR_TOKEN": "seeded-token",
                "CALENDAR_TOKEN_USER_ID": "demo-user",
            }
        )
        self.assertEqual(config.path, TokenMintingPath.ENV)
        self.assertEqual(config.seeded_token, "seeded-token")
        self.assertEqual(config.seeded_user_id, "demo-user")

    def test_endpoint_path_mints_using_factory(self) -> None:
        store = _MemoryStore()
        record = mint_calendar_token(
            user_id="demo-user",
            store=store,
            config=MintingConfig(path=TokenMintingPath.ENDPOINT),
            token_factory=lambda: "generated-token",
        )

        self.assertEqual(record.token, "generated-token")
        self.assertEqual(record.user_id, "demo-user")
        self.assertEqual(store.get("generated-token"), record)

    def test_env_path_uses_seeded_token(self) -> None:
        store = _MemoryStore()
        record = mint_calendar_token(
            user_id="demo-user",
            store=store,
            config=MintingConfig(
                path=TokenMintingPath.ENV,
                seeded_token="seeded-token",
                seeded_user_id="demo-user",
            ),
        )

        self.assertEqual(record.token, "seeded-token")
        self.assertEqual(store.get("seeded-token"), record)

    def test_env_path_requires_calendar_token(self) -> None:
        store = _MemoryStore()
        config = MintingConfig.from_env({"CALENDAR_TOKEN_MINTING_PATH": "env"})
        with self.assertRaisesRegex(CalendarTokenMintingError, "CALENDAR_TOKEN is required"):
            mint_calendar_token(
                user_id="demo-user",
                store=store,
                config=config,
            )

    def test_env_path_allows_unset_calendar_token_user_id(self) -> None:
        store = _MemoryStore()
        config = MintingConfig.from_env(
            {
                "CALENDAR_TOKEN_MINTING_PATH": "env",
                "CALENDAR_TOKEN": "seeded-token",
            }
        )

        record = mint_calendar_token(
            user_id="any-user",
            store=store,
            config=config,
        )
        self.assertEqual(record.token, "seeded-token")
        self.assertEqual(record.user_id, "any-user")

    def test_env_path_rejects_user_mismatch(self) -> None:
        store = _MemoryStore()
        with self.assertRaisesRegex(CalendarTokenMintingError, "does not match"):
            mint_calendar_token(
                user_id="different-user",
                store=store,
                config=MintingConfig(
                    path=TokenMintingPath.ENV,
                    seeded_token="seeded-token",
                    seeded_user_id="demo-user",
                ),
            )


if __name__ == "__main__":
    unittest.main()
