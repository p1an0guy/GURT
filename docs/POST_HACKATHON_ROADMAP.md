# Post-Hackathon Roadmap

This document tracks features intentionally out of scope for hackathon delivery and planned for follow-up phases.

## Phase 1: Canvas and Calendar Hardening

- Add targeted per-course retry input to `POST /canvas/sync` (for example `courseIds` filter).
- Add EventBridge scheduled sync (`rate(24 hours)`) with failure metrics and alerting.
- Add dead-letter queue and replay path for scheduled sync failures.
- Add optional support for Canvas calendar events (beyond assignments-only scope).
- Remove demo fallback behavior for calendar feed when production sync reliability is verified.

## Phase 2: Auth and Multi-User Readiness

- Add end-user authentication and authorization.
- Encrypt and rotate Canvas tokens with dedicated key management.
- Add per-user rate limits and abuse controls.
- Add admin-only diagnostics endpoints for sync status and error traces.

## Phase 3: Ingestion and Retrieval Quality

- Implement full ingestion pipeline quality checks (chunk quality, duplicate detection, OCR confidence scoring).
- Add multi-format ingestion improvements (slides, docs, scanned images) with robust fallback orchestration.
- Add retrieval eval harness with citation precision/recall metrics.

## Phase 4: Learning Product Depth

- Add richer FSRS tuning and personalization loops.
- Add exam-adaptive study planning from historical performance.
- Add practice exam rubric tuning and calibrated scoring.
- Add long-running generation workflows with status tracking and retry controls.

## Phase 5: Frontend and Operational Excellence

- Add `react-dropzone` upload UX for PDF drag/drop, then call `/uploads` and `/docs/ingest`.
- Add full UX for sync status, retry flows, and data freshness timestamps.
- Add observability dashboards (CloudWatch, traces, error budgets).
- Add staging/prod environment split with promotion pipeline.
- Add load/perf testing and cost monitoring guardrails.
