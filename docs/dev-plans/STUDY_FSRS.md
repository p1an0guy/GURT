# Dev 2 Plan — Study Service (FSRS) + Today Queue + Mastery Aggregation

## Mission

Implement web-hosted flashcard study with FSRS scheduling. Provide "today queue" and mastery-by-topic outputs used for the Coverage Tracker. No Anki dependencies.

## Ownership

Route prefix: `/study/*`

## Dependencies

- Card generation writes cards to DynamoDB (Dev 3); you must be able to read them.
- Exam dates come from Canvas items (Dev 1).
- Topic metadata comes from syllabus parsing (Dev 3).

## Deliverables

- FSRS core module + tests
- DynamoDB access patterns for due queue
- Lambda endpoints:
  - `GET /study/today?courseId=...&examId=...`
  - `POST /study/review`
  - `GET /study/mastery?courseId=...&examId=...`

## Step-by-step execution

### 1) FSRS module

- Implement FSRS scheduling function:
  - Input: prior state + rating (1..4) + now
  - Output: updated state + next dueAt
- Add unit tests with fixed seeds and expected outputs.
- Keep it deterministic and pure (no DB calls inside).

### 2) DynamoDB schema and indices

- Cards table should support:
  - query by `userId + courseId`
  - query by `dueAt` for user (GSI recommended)
- Minimum fields per card:
  - `cardId`, `courseId`, `topicId`, `examId?`
  - `front`, `back`, `citations[]`
  - FSRS state: `dueAt`, `stability`, `difficulty`, `reps`, `lapses`, `lastReviewedAt`

### 3) `GET /study/today`

- Inputs:
  - `courseId` required
  - `examId` optional (but used for exam-aware boost)
- Behavior:
  1. Query cards due now (dueAt <= now) for that course.
  2. If exam is within N days:
     - include "boost" cards from low-mastery topics even if not due (selection policy).
  3. Cap size (e.g., 20) and return deterministic ordering:
     - due cards first (earliest dueAt), then boosters (lowest mastery).
- Output: list of cards (minimal fields for UI: cardId/front/back/topicId/citations/state).

### 4) `POST /study/review`

- Input: `{ cardId, rating, responseTimeMs? }`
- Behavior:
  - Fetch card + state
  - Update FSRS state using module
  - Persist updated state atomically
  - Append ReviewLog record
- Output: updated card state + optional next due summary.

### 5) Mastery aggregation

- Mastery is **mastery-based** (not exposure).
- Compute per-topic mastery using review history + FSRS state, e.g.:
  - recency-weighted average of ratings mapped to [0..1]
  - optionally incorporate stability (higher stability => higher mastery)
- Also include quiz signals if `PracticeExamAttempts` exist:
  - topic accuracy influences mastery (weight can be small in MVP).
- Output:
  - `{ topicId, name?, mastery (0..1), atRisk boolean }`
- `atRisk`:
  - if exam in <= X days and mastery < threshold.

### 6) Integrate with smoke tests

- Ensure fixture mode works if cards are not generated yet:
  - optionally return fixture cards for today.
- Ensure endpoints match JSON schemas.

## Smoke tests you must pass

- `GET /study/today` returns list of cards (fixture ok).
- `POST /study/review` updates dueAt and returns updated state.
- `GET /study/mastery` returns topic mastery list.

## Definition of Done

- Reviewing cards updates FSRS state and changes today's queue over time.
- Mastery values are stable and bounded [0..1].
- Outputs are contract-valid and renderable by frontend.
