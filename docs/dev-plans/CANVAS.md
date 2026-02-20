# Dev 1 Plan — Canvas Service + Sync Storage (API Gateway + Lambda + DynamoDB)

## Mission

Implement the Canvas integration service that pulls courses + upcoming items (assignments/events), stores them in DynamoDB, and serves them via contract-stable APIs. Canvas is the source of truth for **dates**.

## Ownership

Route prefix: `/canvas/*`, `/courses*`

## Dependencies

- Must conform to `contracts/openapi.yaml` and JSON schemas.
- Uses Canvas helper patterns from: https://github.com/nriley-14/canvas-scheduler-agent (port the deterministic REST calls, not the REPL agent).

## Deliverables

- Lambda(s) + API routes:
  - `POST /canvas/connect`
  - `POST /canvas/sync`
  - `GET /courses`
  - `GET /courses/{courseId}/items`
  - Optional: `GET /canvas/status`
- DynamoDB tables (or partitions within shared table, depending on infra owner):
  - `CanvasCourses`
  - `CanvasItems`
  - `UserCanvasAuth` (demo token store) OR use env var demo token

## Step-by-step execution

### 1) Define the data models (match contracts)

- `Course` fields: `courseId`, `name`, `term`, `canvasUrl?`
- `CanvasItem` fields:
  - `itemId`, `courseId`
  - `type` (assignment|event|exam_candidate)
  - `title`
  - `dueAt` (ISO string or epoch; match contract)
  - `htmlUrl?`
  - `isExam` boolean (default false)
  - `source` = "canvas"
  - `updatedAt`

### 2) Implement `POST /canvas/connect`

- Input: Canvas base URL + token (for demo; store to DynamoDB keyed by userId).
- Output: success + minimal metadata.
- Include validation errors that are clear for debugging.

### 3) Implement `POST /canvas/sync`

- Load token for user.
- Call Canvas API to:
  - list active courses
  - list upcoming assignments (and/or events if available)
- Normalize to `Course` and `CanvasItem`.
- Upsert to DynamoDB.
- Return: counts + lastSyncAt.

### 4) Implement `GET /courses`

- Return user’s stored courses from DynamoDB.
- Deterministic ordering (e.g., by name).

### 5) Implement `GET /courses/{courseId}/items`

- Return stored `CanvasItems` for course.
- Support query parameters:
  - `?from=...&to=...` optional
  - `?onlyUpcoming=true` optional
- Deterministic ordering by dueAt.

### 6) Exam candidate heuristics (minimal)

- Mark `isExamCandidate=true` if title matches regex like:
  - `/midterm|final|exam|quiz/i`
- Do NOT depend on this for correctness; allow later manual selection in UI.

### 7) Fixture/demo mode fallback

- If env `DEMO_MODE=true`, serve from `fixtures/courses.json` and `fixtures/canvas_items.json`.
- If token invalid or Canvas errors:
  - return a helpful error
  - optionally fall back if `ALLOW_FIXTURE_FALLBACK=true`

### 8) Contract validation

- Add responses that exactly match JSON schemas.
- Run contract validation locally before merge.

## Smoke tests you must pass

- `GET /courses` returns at least 1 course in demo mode.
- `GET /courses/{courseId}/items` returns items with dueAt in valid format.
- `POST /canvas/sync` populates items (or returns fixture results in demo mode).

## Definition of Done

- All endpoints return contract-valid responses.
- Sync writes deterministic records to DynamoDB.
- Fixture mode makes demo robust even if Canvas is flaky.
