# GURT Roadmap (Current State)

Last updated: **February 22, 2026**

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
- Chat responses include structured citations with link-friendly source metadata.
- Ingest observability metrics for finalize/KB-trigger outcomes are implemented.
- Canvas-first ingest UX is finalized in the primary dashboard flow.
- Materials metadata contract + smoke assertions are finalized.
- Web app flashcard workflow supports uploaded notes as selectable sources.

## Recently completed (closed issues on February 22, 2026)

- `#50` Chat citations UX and structure hardening
- `#52` Ingest observability metrics
- `#53` Materials metadata smoke expansion
- `#55` Frontend ingest UX finalization
- `#97` Web app notes upload in flashcard source selection

## Remaining roadmap (mapped to open issues)

1. `#96` Frontend deployment to CloudFront via CDK + extension redirect update
   - Deploy the web app via CloudFront infrastructure and point browser extension redirect flow to the deployed CloudFront URL.
2. `#98` Knowledge Base guardrails for prompt injection/abuse protection
   - Guardrail runtime wiring is present; remaining work is closeout validation, operator documentation, and issue closure.
3. `#99` Browser extension UI parity with web app styling
   - Align extension visuals to the web app UI using existing web app CSS patterns.
   - Core styling updates are merged; remaining work is manual QA capture and issue closeout.

## Execution order

1. `#98`, `#99` closeout validation and documentation pass
2. `#96` CloudFront deployment + extension redirect cutover

## Operator checklist before each merge

- Create/activate `.venv` and install Python deps locally.
- Run contract checks.
- Run smoke checks (mock and/or deployed, depending on change type).
- Run CDK checks when infra code changes.
