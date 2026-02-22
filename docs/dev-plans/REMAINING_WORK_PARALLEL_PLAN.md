# Remaining Work and Progress Plan

Last updated: **February 22, 2026**

This document tracks only active deltas after reassessing open GitHub issues, roadmap state, and current code behavior.

## Active Issue Map

- `#50` Chat: expose structured Bedrock citations and clickable source links
- `#52` Ingest observability: add finalize/KB-trigger metrics and thresholds
- `#53` [BLOCKED] Smoke coverage for materials metadata assertions
- `#55` Frontend ingest UX: finalize Canvas-first vs manual flow and align docs
- `#96` Deploy frontend to CloudFront via CDK and update extension redirect URL
- `#97` Web app: support user-uploaded notes in material selection for flashcard generation
- `#98` Knowledge Base guardrails: add anti-prompt-injection and anti-cheating controls
- `#99` Browser extension UI parity: match web app styling using shared CSS

## Progress Snapshot

1. Calendar hardening + schedule source of truth: `COMPLETE`
2. Ingestion runtime completion: `MOSTLY COMPLETE`
3. Study/generation runtime wiring: `COMPLETE`
4. Frontend runtime hardening: `MOSTLY COMPLETE`
5. CI and merge-gate hardening: `MOSTLY COMPLETE`
6. Extension compatibility docs: `COMPLETE`
7. Bedrock guardrails and abuse protection: `NOT STARTED`
8. Web app uploaded-notes source selection: `NOT STARTED`
9. Browser extension UI parity with web app: `NOT STARTED`
10. Frontend CloudFront deployment and extension redirect alignment: `NOT STARTED`

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

Status: `MOSTLY COMPLETE`

Completed:
- CI executes typecheck/lint/test/build + contract validation + unit tests + mock smoke.
- Conditional CDK checks run when `infra/**` changes.
- Dev smoke workflow exists.
- `main` ruleset enforcement is active and requires status check `contracts-and-tests` (which includes mock smoke gate in CI).

Remaining delta:
- `#53`: extend smoke coverage for materials metadata after contract is finalized.

## 6) Integration Workstream: Extension Compatibility

Status: `COMPLETE`

Completed:
- Extension compatibility docs exist with request/response examples and CORS/auth notes.
- Explicitly documents no extension-specific backend endpoint in this phase.

No remaining delta in current scope.

## 7) Bedrock Guardrails for Prompt-Injection/Abuse Protection

Status: `NOT STARTED`

Remaining delta:
- `#98`: configure and enforce Bedrock guardrails to reduce prompt injection success and block cheating-style misuse prompts, with deterministic user-facing fallback behavior.

## 8) Web App Uploaded Notes in Material Selection

Status: `NOT STARTED`

Remaining delta:
- `#97`: add web-app-only notes upload/selection in the flashcard generation source selector alongside synced materials.

## 9) Browser Extension UI Parity with Web App

Status: `NOT STARTED`

Remaining delta:
- `#99`: align extension UI styling and states to the web app using existing web app CSS patterns.

## 10) Frontend CloudFront Deployment + Extension Redirect Alignment

Status: `NOT STARTED`

Remaining delta:
- `#96`: deploy frontend via CDK-backed CloudFront distribution and update extension redirect target to deployed CloudFront URL.

## Prioritized Remaining Delta Checklist

## P0 (active)

1. `#98` Add Bedrock guardrails with anti-prompt-injection and anti-cheating protections, including runtime enforcement and safe fallback UX.

## P1 (active)

1. `#50` Define and implement structured citation shape for chat responses and frontend rendering as clickable source links.
2. `#52` Add ingest pipeline metrics (finalize + KB trigger) and document thresholds.
3. `#55` Resolve and implement final ingest UX direction in dashboard and docs.
4. `#96` Deploy frontend to CloudFront via CDK and update extension redirect URL.
5. `#97` Add web app notes upload/selection in flashcard source selection flow.
6. `#99` Bring browser extension UI into parity with web app styling.

## Blocked

1. `#53` Add materials metadata smoke assertions only after materials metadata contract finalization.

## Execution Order

1. `#98`
2. `#50`, `#52`, `#55`
3. `#96`, `#97`, `#99`
4. `#53` once unblocked

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
  - Mitigation: keep ruleset required checks current with CI workflow naming and gate changes.
- Risk: materials smoke assertions remain incomplete.
  - Mitigation: keep `#53` explicitly blocked until contract is finalized.
- Risk: prompt injection or cheating requests bypass safe behavior and erode trust.
  - Mitigation: complete `#98` with explicit guardrail coverage and deterministic blocked-response handling.
- Risk: fragmented user experience between web app and extension.
  - Mitigation: complete `#99` and validate visual parity for key extension surfaces.
- Risk: manual/non-deployed frontend access paths confuse extension redirect flow.
  - Mitigation: complete `#96` and document canonical CloudFront URL usage.
- Risk: flashcard generation sources remain constrained to Canvas-only materials.
  - Mitigation: complete `#97` to support user notes upload/selection in web app generation flow.
