"""Token minting orchestration with endpoint/env wiring choices."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import os
import secrets
from typing import Callable, Mapping

from .model import CalendarTokenRecord
from .repository import CalendarTokenStore

TokenFactory = Callable[[], str]


class CalendarTokenMintingError(ValueError):
    """Raised when token minting configuration or flow is invalid."""


class TokenMintingPath(str, Enum):
    """Supported token minting flows."""

    ENDPOINT = "endpoint"
    ENV = "env"


@dataclass(frozen=True)
class MintingConfig:
    """Runtime wiring that selects endpoint or env-driven minting."""

    path: TokenMintingPath = TokenMintingPath.ENDPOINT
    seeded_token: str | None = None
    seeded_user_id: str | None = None

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "MintingConfig":
        source = os.environ if env is None else env
        raw_path = source.get("CALENDAR_TOKEN_MINTING_PATH", TokenMintingPath.ENDPOINT.value)

        try:
            path = TokenMintingPath(raw_path.strip().lower())
        except ValueError as exc:
            raise CalendarTokenMintingError(
                "CALENDAR_TOKEN_MINTING_PATH must be 'endpoint' or 'env'"
            ) from exc

        seeded_token = source.get("CALENDAR_TOKEN", "").strip() or None
        seeded_user_id = source.get("CALENDAR_TOKEN_USER_ID", "").strip() or None
        return cls(path=path, seeded_token=seeded_token, seeded_user_id=seeded_user_id)


def default_token_factory() -> str:
    """Generate a random opaque token suitable for ICS feed URLs."""
    return secrets.token_urlsafe(32)


def mint_calendar_token(
    *,
    user_id: str,
    store: CalendarTokenStore,
    config: MintingConfig,
    token_factory: TokenFactory = default_token_factory,
) -> CalendarTokenRecord:
    """
    Mint and persist a calendar token for a user.

    Endpoint mode:
      - mints a fresh random token.
    Env mode:
      - uses CALENDAR_TOKEN and optionally enforces CALENDAR_TOKEN_USER_ID.
    """
    if not isinstance(user_id, str) or not user_id.strip():
        raise CalendarTokenMintingError("user_id is required")

    if config.path is TokenMintingPath.ENV:
        token = _resolve_seeded_token(user_id=user_id, config=config)
    else:
        token = token_factory()
        if not isinstance(token, str) or not token.strip():
            raise CalendarTokenMintingError("token factory produced an empty token")

    record = CalendarTokenRecord.mint(token=token, user_id=user_id)
    store.save(record)
    return record


def _resolve_seeded_token(*, user_id: str, config: MintingConfig) -> str:
    if not config.seeded_token:
        raise CalendarTokenMintingError(
            "CALENDAR_TOKEN is required when CALENDAR_TOKEN_MINTING_PATH=env"
        )
    if config.seeded_user_id and config.seeded_user_id != user_id:
        raise CalendarTokenMintingError(
            "CALENDAR_TOKEN_USER_ID does not match requested user_id"
        )
    return config.seeded_token

