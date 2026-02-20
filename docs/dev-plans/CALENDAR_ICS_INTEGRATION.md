# Dev 5 Plan — Calendar ICS Service + Demo Glue + Observability

## Mission

Provide a subscribable ICS feed that reflects Canvas items (assignments/exams/office hours) and updates when Canvas deadlines change. Add demo-safety glue and lightweight observability.

## Ownership

Route prefix: `/calendar/*` (ICS)

## Dependencies

- Canvas items stored in DynamoDB by Dev 1.
- Token mapping table exists (token -> userId).
- Smoke test runner expects `/calendar/{token}.ics` to return valid ICS.

## Deliverables

- `GET /calendar/{token}.ics` Lambda (valid ICS output)
- Token system (mint + store) for demo user
- Optional demo fixture mode
- `/health` endpoint or shared health lambda (if not already owned)
- Request-id logging convention

## Step-by-step execution

### 1) Calendar token model

- Create `CalendarTokens` table:
  - PK: token
  - attributes: userId, createdAt, revoked?
- Provide a way to mint token for demo user:
  - either a backend endpoint `POST /calendar/token`
  - or pre-seeded token via infra env var

### 2) ICS generation Lambda

- Input: `{token}`
- Resolve token -> userId
- Query DynamoDB for user’s Canvas items:
  - include assignments + exams (items with isExam or examCandidate)
  - optionally include office hours (if stored from syllabus parsing)
- Render ICS:
  - VCALENDAR wrapper
  - VEVENT per item with:
    - UID: stable (e.g., `studybuddy:<userId>:canvas:<courseId>:<itemId>`)
    - DTSTART: dueAt (convert to UTC or include TZID consistently)
    - SUMMARY: item title
    - DESCRIPTION: include course name + URL if present
    - URL: htmlUrl if present
- Ensure output includes:
  - `BEGIN:VCALENDAR` ... `END:VCALENDAR`
  - At least 1 VEVENT in demo mode.

### 3) Update propagation behavior

- ICS must always use latest stored dueAt.
- If `/canvas/sync` updates an item’s dueAt, the VEVENT’s DTSTART must change (same UID).

### 4) Demo/fixture mode

- If `DEMO_MODE=true`, read from `fixtures/canvas_items.json` and output ICS accordingly.
- This prevents calendar demo failure if Canvas is unavailable.

### 5) Observability and debugging aids

- Add structured logs:
  - requestId, token hash prefix, userId, item count
- Ensure errors are clear:
  - invalid token -> 404 or 401 with minimal message
- (Optional) Implement `/health` that returns:
  - ok + stage + timestamp

## Smoke tests you must pass

- `GET /calendar/{token}.ics` returns valid ICS containing BEGIN/END and at least one VEVENT.
- Updating fixtures or stored items changes DTSTART while keeping UID stable.

## Definition of Done

- A user can subscribe in Google Calendar and see items (initial import).
- ICS output is deterministic and contract-compatible with smoke tests.
- Demo mode exists as a fallback.
