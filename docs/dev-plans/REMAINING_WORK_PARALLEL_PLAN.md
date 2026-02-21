# Remaining Work and Progress Plan

Last updated: **February 21, 2026**

This document tracks only active deltas after reassessing open GitHub issues, roadmap state, and current code behavior.

## Active Issue Map

- `#50` Chat: expose structured Bedrock citations and clickable source links
- `#52` Ingest observability: add finalize/KB-trigger metrics and thresholds
- `#53` [BLOCKED] Smoke coverage for materials metadata assertions
- `#54` Repo governance: enforce required CI/smoke checks via branch protection
- `#55` Frontend ingest UX: finalize Canvas-first vs manual flow and align docs

## Progress Snapshot

1. Calendar hardening + schedule source of truth: `COMPLETE`
2. Ingestion runtime completion: `MOSTLY COMPLETE`
3. Study/generation runtime wiring: `COMPLETE`
4. Frontend runtime hardening: `MOSTLY COMPLETE`
5. CI and merge-gate hardening: `PARTIAL`
6. Extension compatibility docs: `COMPLETE`

## Reassessed Status by Workstream

## 1) Calendar Hardening + Schedule Source of Truth

Status: `COMPLETE`

Completed:
- `/calendar/{token}.ics` uses token-bound user schedule rows.
- Fixture fallback is explicitly gated by demo flags.
- UID stability and due-date update propagation behavior are tested.

No remaining delta in current demo scope.

## 2) Ingestion Runtime Completion (Bedrock KB Trigger + Observability)

Status: `MOSTLY COMPLETE`

Completed:
- Docs finalize triggers KB `StartIngestionJob` automatically.
- KB ingestion result metadata is persisted (`kbIngestionJobId`, `kbIngestionError`).
- Retry-safe client token behavior is implemented and tested.

Remaining delta:
- `#52`: add explicit operational metrics (beyond logs) for finalize and KB-trigger outcomes, plus threshold guidance.

## 3) Study/Generation Endpoint Wiring to Real Runtime State

Status: `COMPLETE`

Completed:
- Runtime-backed generation and study endpoints are implemented.
- FSRS review updates and mastery aggregation are persisted/runtime-backed.
- Exam-aware study queue booster behavior exists with deterministic tests.

No remaining delta in this workstream for the current plan horizon.

## 4) Frontend Completion + UX Error/Retry Hardening

Status: `MOSTLY COMPLETE`

Completed:
- Live/fixture mode and core action flows are wired.
- Retry and error handling exist for sync/ingest/generation/chat actions.
- Status panel includes Canvas sync and KB-ingestion diagnostics.

Remaining delta:
- `#55`: finalize primary ingest UX model (Canvas-first vs manual-first) and align docs/tests.

## 5) CI and Merge-Gate Hardening

Status: `PARTIAL`

Completed:
- CI executes typecheck/lint/test/build + contract validation + unit tests + mock smoke.
- Conditional CDK checks run when `infra/**` changes.
- Dev smoke workflow exists.

Remaining delta:
- `#54`: verify/enforce branch protection required checks in repository settings.
- `#53`: extend smoke coverage for materials metadata after contract is finalized.

## 6) Integration Workstream: Extension Compatibility

Status: `COMPLETE`

Completed:
- Extension compatibility docs exist with request/response examples and CORS/auth notes.
- Explicitly documents no extension-specific backend endpoint in this phase.

No remaining delta in current scope.

## Prioritized Remaining Delta Checklist

## P1 (active)

1. `#50` Define and implement structured citation shape for chat responses and frontend rendering as clickable source links.
2. `#52` Add ingest pipeline metrics (finalize + KB trigger) and document thresholds.
3. `#55` Resolve and implement final ingest UX direction in dashboard and docs.

## P2 (active)

1. `#54` Confirm/enforce required checks through branch protection for `main`.

## Blocked

1. `#53` Add materials metadata smoke assertions only after materials metadata contract finalization.

## Execution Order

1. `#50`, `#52`, `#55`
2. `#54`
3. `#53` once unblocked

## Final Integration Checklist (Current)

- `python scripts/validate_contracts.py`
- `SMOKE_MOCK_MODE=1 python scripts/run_smoke_tests.py`
- `python -m pytest -q`
- `./scripts/check-cdk.sh` (if `infra/**` changed)
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

## Risks and Mitigations

- Risk: unresolved mixed ingest UX increases demo confusion.
  - Mitigation: complete `#55` and align docs/UI state messaging.
- Risk: ingest failures are harder to triage without metrics.
  - Mitigation: complete `#52` with stage-level metrics and runbook thresholds.
- Risk: merge gates drift from expected checks.
  - Mitigation: complete `#54` and record enforced checks in docs.
- Risk: materials smoke assertions remain incomplete.
  - Mitigation: keep `#53` explicitly blocked until contract is finalized.
