from datetime import datetime, timedelta, timezone
import unittest

from study.fsrs import FSRSState, format_rfc3339_utc, parse_rfc3339_utc, schedule_review


class FSRSTestCase(unittest.TestCase):
    def test_first_review_good_is_deterministic(self) -> None:
        updated = schedule_review(None, 3, "2026-09-01T10:15:00Z")

        self.assertEqual(
            updated,
            {
                "dueAt": "2026-09-02T10:15:00Z",
                "stability": 2.5,
                "difficulty": 4.7,
                "reps": 1,
                "lapses": 0,
                "lastReviewedAt": "2026-09-01T10:15:00Z",
            },
        )

    def test_followup_easy_review_is_deterministic(self) -> None:
        first = schedule_review(None, 3, "2026-09-01T10:15:00Z")
        updated = schedule_review(first, 4, "2026-09-04T10:15:00Z")

        self.assertEqual(
            updated,
            {
                "dueAt": "2026-09-09T16:12:10Z",
                "stability": 3.887432,
                "difficulty": 4.127273,
                "reps": 2,
                "lapses": 0,
                "lastReviewedAt": "2026-09-04T10:15:00Z",
            },
        )

    def test_lapse_review_sets_short_relearn_interval(self) -> None:
        first = schedule_review(None, 3, "2026-09-01T10:15:00Z")
        second = schedule_review(first, 4, "2026-09-04T10:15:00Z")
        updated = schedule_review(second, 1, "2026-09-09T10:15:00Z")

        self.assertEqual(
            updated,
            {
                "dueAt": "2026-09-09T14:15:00Z",
                "stability": 2.138088,
                "difficulty": 5.127273,
                "reps": 3,
                "lapses": 1,
                "lastReviewedAt": "2026-09-09T10:15:00Z",
            },
        )

    def test_rating_validation_is_strict(self) -> None:
        with self.assertRaisesRegex(ValueError, "rating must be in range 1..4"):
            schedule_review(None, 5, "2026-09-01T10:15:00Z")

    def test_timestamp_helpers_require_rfc3339_utc_z(self) -> None:
        with self.assertRaisesRegex(ValueError, "trailing Z"):
            parse_rfc3339_utc("2026-09-01T10:15:00+00:00")

        self.assertEqual(
            format_rfc3339_utc(datetime(2026, 9, 1, 10, 15, 0)),
            "2026-09-01T10:15:00Z",
        )

        parsed = parse_rfc3339_utc("2026-09-01T10:15:00.999999Z")
        self.assertEqual(format_rfc3339_utc(parsed), "2026-09-01T10:15:00Z")

    def test_schedule_review_accepts_timezone_aware_datetime(self) -> None:
        pacific_tz = timezone(timedelta(hours=-7))
        now = datetime(2026, 9, 1, 3, 15, 0, tzinfo=pacific_tz)

        updated = schedule_review(None, 3, now)
        self.assertEqual(updated["lastReviewedAt"], "2026-09-01T10:15:00Z")
        self.assertEqual(updated["dueAt"], "2026-09-02T10:15:00Z")

    def test_schedule_review_accepts_naive_datetime_as_utc(self) -> None:
        now = datetime(2026, 9, 1, 10, 15, 0)
        updated = schedule_review(None, 3, now)
        self.assertEqual(updated["lastReviewedAt"], "2026-09-01T10:15:00Z")

    def test_fsrs_state_from_mapping_requires_keys(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing required state keys"):
            FSRSState.from_mapping({"dueAt": "2026-09-01T10:15:00Z"})

    def test_fsrs_state_from_mapping_rejects_invalid_counts(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-negative"):
            FSRSState.from_mapping(
                {
                    "dueAt": "2026-09-01T10:15:00Z",
                    "stability": 2.5,
                    "difficulty": 4.7,
                    "reps": -1,
                    "lapses": 0,
                    "lastReviewedAt": "2026-09-01T10:15:00Z",
                }
            )

    def test_fsrs_state_from_mapping_rejects_non_positive_stability(self) -> None:
        with self.assertRaisesRegex(ValueError, "stability must be positive"):
            FSRSState.from_mapping(
                {
                    "dueAt": "2026-09-01T10:15:00Z",
                    "stability": 0,
                    "difficulty": 4.7,
                    "reps": 1,
                    "lapses": 0,
                    "lastReviewedAt": "2026-09-01T10:15:00Z",
                }
            )

    def test_fsrs_state_from_mapping_rejects_non_z_timestamps(self) -> None:
        with self.assertRaisesRegex(ValueError, "trailing Z"):
            FSRSState.from_mapping(
                {
                    "dueAt": "2026-09-01T10:15:00+00:00",
                    "stability": 2.5,
                    "difficulty": 4.7,
                    "reps": 1,
                    "lapses": 0,
                    "lastReviewedAt": "2026-09-01T10:15:00Z",
                }
            )


if __name__ == "__main__":
    unittest.main()
