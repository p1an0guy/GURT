# Remaining Work and Progress Plan

Last updated: **February 21, 2026**

This document is the current source of truth for what is complete vs. still open after the original parallel plan was drafted.

## Scope

Still in scope:
- Remaining backend/runtime hardening needed for demo-ready and merge-gated stability.
- CI coverage and operational hardening deltas.
- Cross-stream integration cleanup.

Out of scope:
- Re-doing completed calendar isolation/fallback work.
- Re-doing completed extension compatibility documentation.

## Current Progress Snapshot

1. **Calendar hardening + schedule source of truth**: `COMPLETE`
2. **Ingestion runtime completion**: `MOSTLY COMPLETE`
3. **Study/generation runtime wiring**: `MOSTLY COMPLETE`
4. **Frontend runtime hardening**: `MOSTLY COMPLETE`
5. **CI and merge-gate hardening**: `PARTIAL`
6. **Extension compatibility docs**: `COMPLETE`

## Workstream Status and Remaining Delta

## 1) Calendar Hardening + Schedule Source of Truth

Status: `COMPLETE`

Completed:
- `/calendar/{token}.ics` is derived from token user schedule rows.
- Fixture fallback is gated by explicit demo flag + demo user checks.
- Stable UID behavior is preserved across due date changes.
- Tests cover user isolation and fallback on/off behavior.

No remaining delta for this workstream in demo scope.

## 2) Ingestion Runtime Completion (Bedrock KB Trigger + Observability)

Status: `MOSTLY COMPLETE`

Completed:
- `StartIngestionJob` is triggered automatically on successful finalize.
- KB ingestion result metadata (`kbIngestionJobId` / `kbIngestionError`) is persisted.
- Retry-safe client token semantics are implemented and tested.
- Error paths are captured and surfaced as actionable messages.

Remaining delta:
- Add explicit operational metrics (not just logs) around extract -> finalize -> KB trigger outcomes.

## 3) Study/Generation Endpoint Wiring to Real Runtime State

Status: `MOSTLY COMPLETE`

Completed:
- Runtime-backed implementations exist for:
  - `POST /generate/flashcards`
  - `POST /generate/practice-exam`
  - `GET /study/today`
  - `POST /study/review`
  - `GET /study/mastery`
- FSRS updates are persisted from review events.
- Generation outputs include citations with fallback behavior.
- Unit tests cover citation behavior and FSRS state transitions.

Remaining delta:
- Implement explicit exam-aware prioritization path in `GET /study/today`.

## 4) Frontend Completion + UX Error/Retry Hardening

Status: `MOSTLY COMPLETE`

Completed:
- Live-mode integration for sync/study/generation/chat surfaces exists.
- Retry/error states are present for sync/ingest/generation/chat actions.
- Status panel exposes last sync and KB-ingestion outcome fields.

Remaining delta:
- Finalize UI direction for manual ingest controls vs. Canvas-first ingest UX in the main dashboard.

## 5) CI and Merge-Gate Hardening

Status: `PARTIAL`

Completed:
- CI workflow runs frontend typecheck/lint/test/build plus contract checks, unit tests, mock smoke tests.
- CI includes conditional CDK check execution when `infra/**` changes.
- Dev smoke workflow exists for deployed environment.
- Smoke includes calendar token + ICS assertions and ingest start/status happy path.

Remaining delta:
- Add smoke assertion coverage for materials metadata path once that endpoint/shape is finalized.
- Verify GitHub branch protection is configured so CI + smoke checks are actually required gates (repository settings check, not code).

## 6) Integration Workstream: Extension Compatibility (No Endpoint Changes)

Status: `COMPLETE`

Completed:
- Extension compatibility doc exists with request/response examples, CORS guidance, and failure handling.
- Documentation explicitly states no extension-only endpoint in this phase.

No remaining delta for this workstream in demo scope.

## Prioritized Remaining Delta Checklist

## P0

1. Implement exam-aware prioritization in `GET /study/today`.
2. Add/extend tests that prove exam-proximity or exam-linked topic boosters are included deterministically.
3. Update `docs/OVERVIEW.md` with the exact prioritization rule used.

## P1

1. Add explicit operational metrics for ingest pipeline stages:
   - finalize success/failure
   - KB trigger started/succeeded/failed
   - missing KB config cases
2. Document metric names and expected alert thresholds in `docs/TESTING.md` or an ops runbook.

## P2

1. Add smoke checks for materials metadata endpoint once endpoint contract is stable.
2. Confirm branch protection requires CI and smoke workflows for merge to `main`.
3. Resolve frontend ingest UX direction in `app/page.tsx` and align `docs/TESTING.md`.

## Merge Order for Remaining Delta

1. P0: Study queue prioritization.
2. P1: Ingest operational metrics and docs.
3. P2: Smoke expansion + branch protection verification + frontend ingest UX finalization.

## Final Integration Checklist (Current)

- `python scripts/validate_contracts.py`
- `SMOKE_MOCK_MODE=1 python scripts/run_smoke_tests.py`
- `python -m pytest -q`
- `./scripts/check-cdk.sh` (when `infra/**` changes)
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

## Risks and Mitigations

- Risk: fixture/runtime divergence reappears during parallel merges.
  - Mitigation: keep contract + smoke checks mandatory on every merge path.
- Risk: exam-aware prioritization remains undefined, causing inconsistent study queue behavior.
  - Mitigation: lock a deterministic prioritization rule and test it.
- Risk: ingest failures are hard to triage without metricized visibility.
  - Mitigation: add stage-level metrics with clear alert thresholds.
