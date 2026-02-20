"""Pure, deterministic FSRS-style scheduling helpers for study reviews.

This module is intentionally internal foundation code and is not yet wired
directly into `/study/*` API response payloads.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping
import re

UTC = timezone.utc

_RFC3339_UTC_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$"
)

_DEFAULT_DIFFICULTY = 5.0
_MIN_STABILITY = 0.15
_MAX_DIFFICULTY = 10.0
_MIN_DIFFICULTY = 1.0

_FIRST_INTERVAL_DAYS = {1: 0.0, 2: 1.0 / 24.0, 3: 1.0, 4: 3.0}
_FIRST_STABILITY = {1: 0.30, 2: 0.80, 3: 2.50, 4: 4.00}
_FIRST_DIFFICULTY_DELTA = {1: 1.20, 2: 0.40, 3: -0.30, 4: -0.80}

_REVIEW_DIFFICULTY_DELTA = {1: 1.00, 2: 0.30, 3: -0.15, 4: -0.45}
_REVIEW_INTERVAL_FACTOR = {2: 0.80, 3: 1.00, 4: 1.35}
_RELEARN_INTERVAL_DAYS = 4.0 / 24.0


def parse_rfc3339_utc(timestamp: str) -> datetime:
    """Parse strict RFC3339 timestamp in UTC with trailing Z."""
    if not isinstance(timestamp, str) or not _RFC3339_UTC_RE.match(timestamp):
        raise ValueError("timestamp must be RFC3339 UTC with trailing Z")

    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include UTC timezone")
    return parsed.astimezone(UTC)


def format_rfc3339_utc(dt: datetime) -> str:
    """Format datetime as RFC3339 UTC with trailing Z and second precision.

    Naive datetimes are treated as UTC for practical call-site ergonomics.
    """
    if not isinstance(dt, datetime):
        raise ValueError("datetime must be a datetime instance")

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)

    normalized = dt.astimezone(UTC).replace(microsecond=0)
    return normalized.isoformat().replace("+00:00", "Z")


def _coerce_utc_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    return parse_rfc3339_utc(value)


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _rounded(value: float) -> float:
    return round(float(value), 6)


def _retrievability(stability: float, elapsed_days: float) -> float:
    return (1.0 + (elapsed_days / max(stability, _MIN_STABILITY))) ** -1.0


@dataclass(frozen=True)
class FSRSState:
    """Serialized card scheduling state used by study endpoints."""

    due_at: str
    stability: float
    difficulty: float
    reps: int
    lapses: int
    last_reviewed_at: str

    @classmethod
    def from_mapping(cls, state: Mapping[str, Any]) -> "FSRSState":
        """Build state from API-style mapping."""
        required = {"dueAt", "stability", "difficulty", "reps", "lapses", "lastReviewedAt"}
        missing = required - set(state.keys())
        if missing:
            raise ValueError(f"missing required state keys: {sorted(missing)}")

        due_at = format_rfc3339_utc(parse_rfc3339_utc(str(state["dueAt"])))
        last_reviewed_at = format_rfc3339_utc(parse_rfc3339_utc(str(state["lastReviewedAt"])))
        stability = float(state["stability"])
        difficulty = float(state["difficulty"])
        reps = int(state["reps"])
        lapses = int(state["lapses"])

        if reps < 0 or lapses < 0:
            raise ValueError("reps and lapses must be non-negative")
        if stability <= 0:
            raise ValueError("stability must be positive")

        return cls(
            due_at=due_at,
            stability=stability,
            difficulty=_clamp(difficulty, _MIN_DIFFICULTY, _MAX_DIFFICULTY),
            reps=reps,
            lapses=lapses,
            last_reviewed_at=last_reviewed_at,
        )

    def to_mapping(self) -> dict[str, Any]:
        """Return API-style scheduling state mapping."""
        return {
            "dueAt": format_rfc3339_utc(parse_rfc3339_utc(self.due_at)),
            "stability": _rounded(self.stability),
            "difficulty": _rounded(self.difficulty),
            "reps": self.reps,
            "lapses": self.lapses,
            "lastReviewedAt": format_rfc3339_utc(parse_rfc3339_utc(self.last_reviewed_at)),
        }


def _first_review(now: datetime, rating: int) -> FSRSState:
    stability = _FIRST_STABILITY[rating]
    difficulty = _clamp(
        _DEFAULT_DIFFICULTY + _FIRST_DIFFICULTY_DELTA[rating],
        _MIN_DIFFICULTY,
        _MAX_DIFFICULTY,
    )
    due_at = now + timedelta(days=_FIRST_INTERVAL_DAYS[rating])
    return FSRSState(
        due_at=format_rfc3339_utc(due_at),
        stability=stability,
        difficulty=difficulty,
        reps=1,
        lapses=1 if rating == 1 else 0,
        last_reviewed_at=format_rfc3339_utc(now),
    )


def schedule_review(
    prior_state: Mapping[str, Any] | None, rating: int, now: str | datetime
) -> dict[str, Any]:
    """Apply deterministic FSRS-style scheduling update for one review.

    Args:
        prior_state: Existing scheduling state for a card, or None for first review.
        rating: User review quality from 1..4 (Again, Hard, Good, Easy).
        now: Review timestamp as RFC3339 UTC with trailing Z, or datetime.
            Naive datetimes are treated as UTC.

    Returns:
        Updated scheduling state mapping.
    """
    if rating not in (1, 2, 3, 4):
        raise ValueError("rating must be in range 1..4")

    now_dt = _coerce_utc_datetime(now)
    if prior_state is None:
        return _first_review(now_dt, rating).to_mapping()

    current = FSRSState.from_mapping(prior_state)
    current_last = parse_rfc3339_utc(current.last_reviewed_at)
    elapsed_days = max(0.0, (now_dt - current_last).total_seconds() / 86400.0)
    retrievability = _retrievability(current.stability, elapsed_days)
    retention_gap = max(0.0, 1.0 - retrievability)

    if rating == 1:
        next_stability = max(_MIN_STABILITY, current.stability * 0.55)
        interval_days = _RELEARN_INTERVAL_DAYS
        next_lapses = current.lapses + 1
        difficulty_delta = _REVIEW_DIFFICULTY_DELTA[rating]
    else:
        gain = 1.0 + (0.25 + 0.08 * rating) * (1.0 + retention_gap) * (
            (11.0 - current.difficulty) / 10.0
        )
        next_stability = max(_MIN_STABILITY, current.stability * gain)
        interval_days = next_stability * _REVIEW_INTERVAL_FACTOR[rating]
        next_lapses = current.lapses
        difficulty_delta = _REVIEW_DIFFICULTY_DELTA[rating] * (1.0 + retention_gap * 0.5)

    next_difficulty = _clamp(
        current.difficulty + difficulty_delta,
        _MIN_DIFFICULTY,
        _MAX_DIFFICULTY,
    )
    next_due = now_dt + timedelta(days=interval_days)

    updated = FSRSState(
        due_at=format_rfc3339_utc(next_due),
        stability=next_stability,
        difficulty=next_difficulty,
        reps=current.reps + 1,
        lapses=next_lapses,
        last_reviewed_at=format_rfc3339_utc(now_dt),
    )
    return updated.to_mapping()
