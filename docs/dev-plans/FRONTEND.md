# Dev 4 Plan — Frontend Web App (Dashboard + Study + Practice Exam + Calendar Subscribe)

## Mission

Build the demo-ready web UI that exercises the full product loop:
Canvas sync -> upload/ingest -> generate -> study (FSRS) -> mastery bars -> practice exam -> calendar subscription.

## Ownership

Frontend app only.

## Dependencies

- Backend endpoints and contract shapes from `contracts/openapi.yaml`
- Fixture files for local dev and demo fallback

## Deliverables

- Pages:
  1. Connect Canvas + Sync
  2. Course picker + Course dashboard
  3. Upload/ingest panel
  4. Study session (flashcards)
  5. Practice exam (take + results)
  6. Calendar subscription panel (ICS URL + instructions)
- Robust loading/error states + demo-safe fallback to fixtures

## Step-by-step execution

### 1) App scaffold and API client

- Implement typed API client matching contracts.
- Implement feature flag `USE_FIXTURES=true` to use `fixtures/` responses.

### 2) Connect + Sync flow

- UI for token input (demo).
- Button to call `POST /canvas/connect` then `POST /canvas/sync`.
- Course list using `GET /courses`.

### 3) Course dashboard

- Show upcoming Canvas items from `GET /courses/{courseId}/items`.
- Exam picker:
  - allow user to select an exam candidate item
  - store selection in frontend state for generation/study

### 4) Upload + ingest

- Upload syllabus + slides/notes + scanned notes.
- Call upload endpoint then ingest endpoint.
- Show ingestion status (doc count, chunk count).

### 5) Generate flashcards + practice exam

- Buttons:
  - "Generate Flashcards" -> `POST /generate/flashcards`
  - "Generate Practice Exam" -> `POST /generate/practice-exam`
- Show success counts and citations preview.

### 6) Study session UI

- "Start Today’s Plan" -> `GET /study/today`
- Card UI:
  - front/back reveal
  - rating buttons -> `POST /study/review`
- After each review:
  - refresh mastery summary from `GET /study/mastery`
- Keep session smooth: optimistic UI updates OK.

### 7) Practice exam UI

- Render questions (MCQ + short answer).
- Submit -> `/practice-exam/submit`
- Results page:
  - score
  - per-topic breakdown
  - citations and explanations

### 8) Coverage tracker (mastery bars)

- Render per-topic mastery bars using `GET /study/mastery`.
- Highlight `atRisk`.

### 9) Calendar subscribe panel

- Display ICS URL: `/calendar/<token>.ics`
- Provide copy button + “Add by URL” Google Calendar instructions.
- Small note: refresh timing controlled by Google (don’t overemphasize).

## Definition of Done

- Full demo works from UI end-to-end.
- If backend is down, fixture mode can still run a full “fake demo.”
