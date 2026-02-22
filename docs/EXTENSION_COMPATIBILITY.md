# Chrome Extension Compatibility (Demo Phase)

This project does not expose a separate extension-specific backend route in the hackathon phase.
The extension uses the same public API routes as the web app.
Study/import redirects are opened against the frontend base URL configured in
`browserextention/deployment_config.json` (`webAppBaseUrl`), which is synced from
CDK output `FrontendCloudFrontUrl` by `scripts/deploy.sh`.

## Backend routes used by extension

- `POST /chat`
- `POST /uploads`
- `POST /docs/ingest`
- `GET /docs/ingest/{jobId}` (status polling for started ingest jobs)

## Chat endpoint contract

- Method: `POST`
- URL: `<DEV_BASE_URL>/chat`
- Headers:
  - `Content-Type: application/json`
- Body:

```json
{
  "courseId": "course-psych-101",
  "question": "What are the key terms for week 3?"
}
```

- Success (`200`):

```json
{
  "answer": "Grounded response text...",
  "citations": [
    "s3://<bucket>/<key>#chunk-2"
  ]
}
```

- Error (`400`):
  - malformed JSON
  - missing/empty `courseId` or `question`
- Error (`502`):
  - model retrieval/generation failure
  - knowledge base retrieval unavailable

## Module scraping fallback workflow (Canvas files)

Use this fallback when Canvas file API sync through `POST /canvas/sync` is partial/unreliable for a course.

High-level flow:

1. Open Canvas modules page: `/courses/{courseId}/modules`.
2. Side panel requests module scrape from background worker.
3. Content script discovers module file candidates from page DOM.
4. For each accepted candidate, background executes:
   - `POST /uploads` (obtain presigned upload metadata)
   - S3 `PUT` to `uploadUrl`
   - `POST /docs/ingest` (start ingest job)
   - Upload content type mapping:
     - `.pdf` -> `application/pdf`
     - `.pptx` -> `application/vnd.openxmlformats-officedocument.presentationml.presentation`
     - `.docx` -> `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
     - code/text extensions (for example `.py`, `.sv`, `.v`, `.asm`, `.c`, `.ts`, `.js`, `.txt`, `.md`, `.json`, `.yaml`) -> `text/plain`
5. Extension emits completion summary with counters:
   - `discovered`
   - `uploaded`
   - `ingest-started`
   - `skipped`
   - `failed`

## Message/event flow expectations

This flow is extension-internal (side panel <-> background <-> content script), but should preserve the phase ordering below.

1. Start event: side panel sends `SCRAPE_MODULES_START`.
2. Discovery event: content script handles `SCRAPE_MODULES_START` and emits `SCRAPE_MODULES_PROGRESS`; background forwards these as `SCRAPE_PROGRESS`.
3. Upload/ingest progress: background emits `SCRAPE_PROGRESS` with per-file statuses while calling `/uploads` and `/docs/ingest`.
4. Completion/error events: background emits `SCRAPE_COMPLETE` or `SCRAPE_ERROR` with counters and per-file details.
5. Optional cancellation: side panel can send `SCRAPE_CANCEL`.

Example completion payload shape:

```json
{
  "courseId": "170880",
  "counters": {
    "discovered": 12,
    "uploaded": 9,
    "ingestStarted": 8,
    "skipped": 2,
    "failed": 1
  }
}
```

UI label `ingest-started` maps to payload field `ingestStarted`.

## CORS behavior

- Demo API is configured with CORS preflight + runtime CORS headers.
- Current demo deploy default allows all origins (`*`) and `GET,POST,OPTIONS`.
- If CORS is later tightened, include the extension origin (`chrome-extension://<EXTENSION_ID>`) in the allowed origins list.

## Auth model in demo

- `POST /chat` currently uses `AuthorizationType.NONE` for hackathon/demo operation.
- No extension-only auth token is required in this phase.
- Do not assume this policy for production hardening.

## Failure-handling expectations

Chat path:

- On `400` from `/chat`: show actionable input error and do not auto-retry.
- On `502` from `/chat`: show temporary backend/model failure and allow retry.
- On network/CORS failure (`TypeError: Failed to fetch`) for API calls:
  - verify API base URL includes stage (for example `/dev`)
  - verify deployed CORS settings
  - verify extension host permissions include the API domain

Module scrape fallback path:

- Continue-on-error: one file failure must not abort the whole scrape run.
- Classification:
  - `skipped`: unsupported file type, duplicate/already-processed file, or missing required link metadata.
  - `failed`: file accepted for processing but failed during download, `POST /uploads`, S3 `PUT`, or `POST /docs/ingest`.
- Counter semantics:
  - increment `uploaded` only after successful `/uploads` + S3 `PUT`.
  - increment `ingest-started` only after `/docs/ingest` returns `202`.
  - keep `ingest-started` unchanged if later ingest status becomes `FAILED`; report that as an ingest-job failure in status details.
- Completion semantics:
  - always emit final counters even when all candidates are skipped/failed.
  - include actionable error details (`file`, `stage`, `error`) for retries.

## Quick validation command

```bash
curl -sS -X POST "$BASE_URL/chat" \
  -H 'content-type: application/json' \
  -d '{"courseId":"course-psych-101","question":"Summarize upcoming deadlines."}' | jq
```
