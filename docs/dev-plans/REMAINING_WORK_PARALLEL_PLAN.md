# Remaining Work and Progress Plan

Last updated: **February 22, 2026**

This document tracks only active deltas after reassessing open GitHub issues, roadmap state, and current code behavior.

## Active Issue Map

- `#96` Deploy frontend to CloudFront via CDK and update extension redirect URL
- `#98` Knowledge Base guardrails: add anti-prompt-injection and anti-cheating controls
- `#99` Browser extension UI parity: match web app styling using shared CSS

## Progress Snapshot

1. Calendar hardening + schedule source of truth: `COMPLETE`
2. Ingestion runtime completion: `COMPLETE`
3. Study/generation runtime wiring: `COMPLETE`
4. Frontend runtime hardening: `COMPLETE`
5. CI and merge-gate hardening: `COMPLETE`
6. Extension compatibility docs: `COMPLETE`
7. Bedrock guardrails and abuse protection: `IN REVIEW`
8. Web app uploaded-notes source selection: `COMPLETE`
9. Browser extension UI parity with web app: `IN REVIEW`
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

Status: `COMPLETE`

Completed:
- Docs finalize triggers KB `StartIngestionJob` automatically.
- KB ingestion result metadata is persisted (`kbIngestionJobId`, `kbIngestionError`).
- Retry-safe client token behavior is implemented and tested.

Remaining delta:
- None in current scope (`#52` is closed).

## 3) Study/Generation Endpoint Wiring to Real Runtime State

Status: `COMPLETE`

Completed:
- Runtime-backed generation and study endpoints are implemented.
- FSRS review updates and mastery aggregation are persisted/runtime-backed.
- Exam-aware study queue booster behavior exists with deterministic tests.

No remaining delta in this workstream for the current plan horizon.

## 4) Frontend Completion + UX Error/Retry Hardening

Status: `COMPLETE`

Completed:
- Live/fixture mode and core action flows are wired.
- Retry and error handling exist for sync/ingest/generation/chat actions.
- Status panel includes Canvas sync and KB-ingestion diagnostics.

Remaining delta:
- None in current scope (`#55` is closed).

## 5) CI and Merge-Gate Hardening

Status: `COMPLETE`

Completed:
- CI executes typecheck/lint/test/build + contract validation + unit tests + mock smoke.
- Conditional CDK checks run when `infra/**` changes.
- Dev smoke workflow exists.
- `main` ruleset enforcement is active and requires status check `contracts-and-tests` (which includes mock smoke gate in CI).

Remaining delta:
- None in current scope (`#53` is closed).

## 6) Integration Workstream: Extension Compatibility

Status: `COMPLETE`

Completed:
- Extension compatibility docs exist with request/response examples and CORS/auth notes.
- Explicitly documents no extension-specific backend endpoint in this phase.

No remaining delta in current scope.

## 7) Bedrock Guardrails for Prompt-Injection/Abuse Protection

Status: `IN REVIEW`

Remaining delta:
- `#98`: complete closeout validation and docs pass, then close issue.
- Runtime and infra wiring are in code (`backend/generation.py`, `backend/runtime.py`, `infra/stacks/api_stack.py`), but issue lifecycle is still open.

## 8) Web App Uploaded Notes in Material Selection

Status: `COMPLETE`

Remaining delta:
- None in current scope (`#97` is closed).

## 9) Browser Extension UI Parity with Web App

Status: `IN REVIEW`

Remaining delta:
- `#99`: closeout QA screenshots and issue closure.
- Styling parity changes are present in extension CSS (`browserextention/sidepanel.css`, `browserextention/options.css`), but issue lifecycle is still open.

## 10) Frontend CloudFront Deployment + Extension Redirect Alignment

Status: `NOT STARTED`

Remaining delta:
- `#96`: deploy frontend via CDK-backed CloudFront distribution and update extension redirect target to deployed CloudFront URL.

## Prioritized Remaining Delta Checklist

## P0 (active)

1. `#98` Finalize guardrail validation/docs and close issue.

## P1 (active)

1. `#99` Finalize extension UI parity QA evidence and close issue.
2. `#96` Deploy frontend to CloudFront via CDK and update extension redirect URL.

## Execution Order

1. `#98` closeout
2. `#99` closeout
3. `#96` implementation + rollout

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
  - Mitigation: monitor post-closeout behavior from `#55` in regression checks.
- Risk: merge gates drift from expected checks.
  - Mitigation: keep ruleset required checks current with CI workflow naming and gate changes.
- Risk: prompt injection or cheating requests bypass safe behavior and erode trust.
  - Mitigation: close out `#98` with deterministic blocked-response checks and operator docs.
- Risk: fragmented user experience between web app and extension.
  - Mitigation: close out `#99` with before/after QA evidence on core extension surfaces.
- Risk: manual/non-deployed frontend access paths confuse extension redirect flow.
  - Mitigation: complete `#96` and document canonical CloudFront URL usage and extension redirect target.
