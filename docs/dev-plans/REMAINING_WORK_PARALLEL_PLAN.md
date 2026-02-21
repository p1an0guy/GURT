# Remaining Work Plan (After Canvas Materials Sync + Extension Are In Progress)

## Scope Correction

This plan intentionally excludes:
- Canvas materials sync implementation work already in progress.
- Chrome extension implementation work already in progress.

This plan covers the remaining delivery work needed to reach demo-ready and merge-gated stability.

## Assumed Current State

- `POST /canvas/connect` and `POST /canvas/sync` exist and run.
- Canvas materials sync is actively being implemented by another stream.
- Chrome extension chatbot MVP is actively being implemented by another stream.
- Calendar token mint + ICS feed endpoints are live.
- Ingest workflow exists (`POST /docs/ingest` + status polling), but Bedrock KB ingestion job trigger still needs full runtime wiring.

If any assumption is incorrect, adjust only the affected workstream backlog, not ownership boundaries.

## Remaining Workstreams (Parallel)

## 1) Calendar Hardening + Schedule Source of Truth

Branch:
- `feature/calendar-hardening-remove-fallback`

Ownership:
- `backend/runtime.py`
- `contracts/openapi.yaml` (only if behavior requires explicit docs update)
- `docs/ROADMAP.md`
- `docs/OVERVIEW.md` (if architecture behavior changes)

Deliverables:
- Ensure `/calendar/{token}.ics` reads only token user schedule rows in DynamoDB.
- Keep fixture fallback only behind explicit demo flag.
- Remove non-flagged fallback path before production hardening.
- Confirm sync updates propagate into ICS event updates with stable UID behavior.
- Add tests for:
  - token -> user row isolation
  - empty schedule behavior with fallback off
  - empty schedule behavior with fallback on

Done criteria:
- ICS never leaks cross-user rows.
- ICS behavior deterministic with fallback toggle.
- Tests cover both fallback modes.

## 2) Ingestion Runtime Completion (Bedrock KB Trigger + Observability)

Branch:
- `feature/ingest-runtime-complete`

Ownership:
- `backend/ingest_workflow.py`
- `backend/runtime.py`
- `infra/stacks/knowledge_base_stack.py` (if IAM/env wiring needed)
- `infra/stacks/api_stack.py` (if runtime env/permissions needed)
- `docs/TESTING.md`

Deliverables:
- Trigger Bedrock `StartIngestionJob` automatically after successful docs ingest finalize.
- Persist ingestion job metadata/state for traceability.
- Add failure capture/retry-safe semantics (do not duplicate ingestion for unchanged source revision).
- Add operational logs/metrics points for extract -> ingest trigger.
- Add tests for:
  - successful finalize triggers KB ingestion
  - trigger failure path is surfaced with actionable error
  - idempotent behavior on repeated finalize for same source revision

Done criteria:
- No manual CLI step required for KB ingestion after document ingest.
- Runtime status is queryable and debuggable.

## 3) Study/Generation Endpoint Wiring to Real Runtime State

Branch:
- `feature/study-generation-runtime-wiring`

Ownership:
- `backend/runtime.py`
- `backend/generation.py`
- `study/fsrs.py`
- `contracts/*` (only if contract-compatible additions are required)
- `fixtures/*.json` (only for deterministic smoke coverage)

Deliverables:
- Replace fixture-only behaviors for:
  - `POST /generate/flashcards`
  - `POST /generate/practice-exam`
  - `GET /study/today`
  - `POST /study/review`
  - `GET /study/mastery`
- Wire FSRS updates to persisted review state.
- Ensure generated outputs include citations aligned with contract.
- Validate exam-aware prioritization path for study queue.
- Add tests for:
  - FSRS state transitions from review events
  - mastery updates after review/practice interactions
  - generation output shape + citation presence

Done criteria:
- Endpoints serve runtime-backed data, not placeholder-only fixture logic.
- Contract responses remain valid and deterministic under test fixtures.

## 4) Frontend Completion + UX Error/Retry Hardening

Branch:
- `feature/frontend-runtime-hardening`

Ownership:
- `app/page.tsx` (or split components under `app/**`)
- `src/api/client.ts`
- `src/api/types.ts`
- `src/api/client.test.ts`
- `docs/TESTING.md` (if local workflow changes)

Deliverables:
- Complete live-mode integration for sync, study, and ingest surfaces.
- Add robust error/retry UX for:
  - Canvas sync failures (`failedCourseIds` visibility)
  - ingest polling/terminal failures
  - study action failures
- Add lightweight UI state for:
  - last successful sync time
  - ingest status progression
  - actionable retry buttons
- Ensure no contract drift between client types and OpenAPI schemas.

Done criteria:
- Frontend can demonstrate end-to-end flow against deployed API with no manual JSON calls.
- Retry paths are visible and usable during demo failures.

## 5) CI and Merge-Gate Hardening

Branch:
- `chore/ci-hardening-final-gates`

Ownership:
- `.github/workflows/ci.yml`
- `.github/workflows/smoke-dev.yml`
- `scripts/run_smoke_tests.py`
- `scripts/validate_contracts.py`
- `docs/TESTING.md`

Deliverables:
- Ensure required checks enforce:
  - contract validation
  - smoke-dev workflow
  - CDK checks when `infra/**` changes
- Expand smoke sequence to include:
  - calendar token + ICS fetch assertions
  - materials metadata endpoint assertions (once materials stream merges)
  - ingest start/status happy path
- Keep mock-mode deterministic and fast for PR validation.

Done criteria:
- Required checks block merge on contract/smoke failures.
- Local and CI smoke expectations are aligned and documented.

## Integration Workstream: Extension Compatibility (No Endpoint Changes)

Branch:
- `chore/extension-compatibility-docs`

Ownership:
- `docs/OVERVIEW.md`
- `docs/TESTING.md`
- optional extension-facing README under `docs/`

Deliverables:
- Document stable `POST /chat` usage for extension:
  - request/response examples
  - required headers/base URL format
  - failure handling expectations
- Validate CORS/runtime config supports extension origin model for dev/demo.
- Explicitly state that no dedicated extension endpoint exists in this phase.

Done criteria:
- Extension developer has zero backend ambiguity and can test against deployed API.

## Merge Order

1. Calendar hardening + ingest runtime completion.
2. Study/generation runtime wiring.
3. Frontend runtime hardening.
4. CI gate hardening.
5. Integration pass with in-progress materials sync branch and extension branch.

## Final Integration Checklist

- `python scripts/validate_contracts.py`
- `SMOKE_MOCK_MODE=1 python scripts/run_smoke_tests.py`
- `python -m pytest -q` (where tests exist)
- `./scripts/check-cdk.sh` (if `infra/**` changed)
- Frontend client tests:
  - `npm test`
  - `npm run lint`

## Risks and Mitigations

- Risk: parallel merges reintroduce fixture/runtime divergence.
  - Mitigation: require smoke + contract checks on every merge path.
- Risk: calendar fallback behavior causes demo/prod confusion.
  - Mitigation: enforce explicit flag and test both modes.
- Risk: extension blocked by environment/CORS mismatch.
  - Mitigation: add explicit extension compatibility docs and dev-stage validation.

