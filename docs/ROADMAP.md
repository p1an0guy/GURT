# GURT Roadmap (Post-Smoke Baseline)

## Current baseline

- `main` deploys with `./scripts/deploy.sh` using AWS profile credentials.
- Dev smoke workflow passes against deployed API.
- Calendar token mint + ICS feed endpoints are live.
- Temporary fallback is enabled for calendar ICS when no user schedule rows exist.
- Canvas sync now includes published/visible course materials metadata + S3 mirroring, and can auto-start KB ingestion when KB IDs are configured.

## Next steps (execution order)

1. Replace temporary ICS fallback with real user schedule rows
   - Add Canvas sync write path to persist assignment/event rows in DynamoDB.
   - Ensure `/calendar/{token}.ics` uses token userId -> schedule rows only.
   - Keep fallback behind an explicit demo flag and remove before production hardening.

2. Implement Canvas integration endpoints
   - `POST /canvas/connect`: accept and store Canvas base URL + token metadata for demo user.
   - `POST /canvas/sync`: fetch assignments/events and upsert normalized rows.
   - Baseline complete: `GET /courses` and `GET /courses/{courseId}/items` now read synced Canvas DynamoDB rows first (fixture fallback in demo when no runtime rows exist).
   - Add deterministic tests with fixture-backed Canvas API responses.

3. Build Bedrock-backed ingestion + RAG scaffold
   - `POST /uploads`: S3 upload flow (presign/direct).
   - `POST /docs/ingest`: extract text, chunk, embed, persist metadata.
   - KB ingestion auto-triggers after Canvas materials sync when `KNOWLEDGE_BASE_ID` + `KNOWLEDGE_BASE_DATA_SOURCE_ID` are configured.
   - KB ingestion auto-triggers after Step Functions finalize for non-Canvas uploads (`POST /docs/ingest`) when KB IDs are configured.
   - Add citation structure for downstream flashcard/practice generation.

4. Wire study/generation endpoints from scaffold to runtime
   - `POST /generate/flashcards`
   - `POST /generate/practice-exam`
   - `GET /study/today`, `POST /study/review`, `GET /study/mastery`
   - Baseline complete: generated cards persist to `CardsTable`; review updates FSRS state; mastery can derive from runtime card state with fixture fallback when runtime rows are absent.
   - Preserve contract-first updates for any response shape changes.

5. Frontend integration to deployed dev API
   - Wire Next.js app to `NEXT_PUBLIC_API_BASE_URL`.
   - Add token mint + calendar subscribe flow in UI.
   - Baseline complete: browser shell now supports live Canvas connect/sync, ingest, generate, and chat calls with per-action loading/error/retry states and last-success status panels.

6. CI hardening
   - Keep smoke-dev required for merge.
   - Keep contract validation required for merge.
   - Keep CDK checks (`./scripts/check-cdk.sh`) required when `infra/**` changes.

## Operator checklist before each merge

- Create/activate `.venv` and install Python deps locally.
- Run contract checks.
- Run smoke checks (mock and/or deployed, depending on change type).
- Run CDK checks when infra code changes.
