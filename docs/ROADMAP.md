# GURT Roadmap (Current State)

Last updated: **February 21, 2026**

## Completed baseline

- Canvas integration and storage are live:
  - `POST /canvas/connect`
  - `POST /canvas/sync`
  - `GET /courses`
  - `GET /courses/{courseId}/items`
- Calendar token mint and ICS feed are live with token-user isolation and stable UID behavior.
- Upload + ingest + KB trigger flows are live:
  - `POST /uploads`
  - `POST /docs/ingest`
  - `GET /docs/ingest/{jobId}`
  - KB ingestion trigger from both docs finalize and Canvas materials sync when configured.
- Generation + study runtime flows are live:
  - `POST /generate/flashcards`
  - `POST /generate/practice-exam`
  - `POST /chat`
  - `GET /study/today`, `POST /study/review`, `GET /study/mastery`
- Study queue includes near-exam booster behavior with deterministic ordering tests.
- CI currently runs contracts, tests, and mock smoke checks; CDK checks run conditionally on `infra/**` changes.
- `main` merge governance is enforced via active repository ruleset requiring status check `contracts-and-tests` (which includes the mock smoke gate).

## Remaining roadmap (mapped to open issues)

1. `#50` Chat citations UX and structure hardening
   - Keep responses grounded while exposing citation structure suitable for clickable source links in clients.
2. `#52` Ingest observability metrics
   - Add explicit metrics and thresholds for finalize and KB trigger outcomes.
3. `#55` Frontend ingest UX finalization
   - Resolve mixed dashboard behavior between manual ingest controls and Canvas-first ingest status model.
4. `#53` Blocked smoke expansion
   - Add materials metadata smoke assertions after the materials metadata contract is finalized.

## Execution order

1. `#50`, `#52`, `#55` (active implementation priorities)
2. `#53` (unblock after contract finalization)

## Operator checklist before each merge

- Create/activate `.venv` and install Python deps locally.
- Run contract checks.
- Run smoke checks (mock and/or deployed, depending on change type).
- Run CDK checks when infra code changes.
