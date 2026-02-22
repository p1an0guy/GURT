# Testing and Contract Scaffolding

This repository includes contract-first API assets, deterministic fixtures, and smoke tooling for parallel backend/frontend development.

Python workflow policy: always use a local virtual environment (`.venv`) for this repository. Do not install Python dependencies globally.

## Local setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
npm install
```

## Contract checks (local)

Runs OpenAPI syntax validation and example-vs-schema validation.

```bash
source .venv/bin/activate
python scripts/validate_contracts.py
```

## CDK checks (local, when infra changes)

Run this whenever files under `infra/` change:

```bash
./scripts/check-cdk.sh
```

## Unit tests (local)

Run focused unit tests for backend validation and wiring.

```bash
source .venv/bin/activate
python scripts/test_uploads.py
```

Run all unit tests (including ingest workflow and KB trigger tests):

```bash
source .venv/bin/activate
python -m pytest -q
```

Or with unittest:

```bash
python -m unittest discover -s tests -v
```

## Smoke tests (local, mock mode)

Runs the full smoke sequence without deployed lambdas by serving fixture-backed endpoints from an in-process mock server.

```bash
source .venv/bin/activate
SMOKE_MOCK_MODE=1 python scripts/run_smoke_tests.py
```

Mock smoke assertions now include `GET /courses/{courseId}/materials` and validate:
- every row matches `CourseMaterial.json`
- rows are course-scoped and sorted by `displayName` (case-insensitive)
- response does not expose private fields like `downloadUrl` or `s3Key`
- deterministic fixture IDs for the selected course match exactly

To also exercise `POST /calendar/token` in mock smoke mode, enable token minting:

```bash
source .venv/bin/activate
SMOKE_MOCK_MODE=1 MINT_CALENDAR_TOKEN=1 python scripts/run_smoke_tests.py
```

To include ingest start/status contract checks in mock smoke mode:

```bash
source .venv/bin/activate
SMOKE_MOCK_MODE=1 \
MINT_CALENDAR_TOKEN=1 \
SMOKE_INCLUDE_CANVAS_SYNC=1 \
SMOKE_INCLUDE_CHAT=1 \
SMOKE_INCLUDE_INGEST=1 \
python scripts/run_smoke_tests.py
```

## Smoke tests (local, deployed API)

Use this mode against API Gateway/Lambda environments.

```bash
source .venv/bin/activate
export BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com/dev"
export CALENDAR_TOKEN="<calendar-token>"
export COURSE_ID="course-psych-101"  # optional
python scripts/run_smoke_tests.py
```

Deployed smoke runs perform the same `/courses/{courseId}/materials` schema and metadata safety checks (without enforcing fixture-specific IDs).

## Smoke tests against dev stage (GitHub Actions)

The **Smoke Dev** workflow runs:
- automatically on every push to `main`
- manually via `workflow_dispatch`

Repository secrets:

- `DEV_BASE_URL` (required)
- `DEV_COURSE_ID` (optional; defaults to `course-psych-101` when empty)
- `DEV_CALENDAR_TOKEN` (optional override; when omitted, smoke mints a fresh token via `POST /calendar/token`)

In the current demo scaffold, `POST /calendar/token` is intentionally `AuthorizationType.NONE`
because org SCP policies may deny `execute-api:Invoke`. Runtime falls back to `DEMO_USER_ID` when
no authenticated principal is present and `DEMO_MODE=true`.

Canvas bootstrap for demo schedule rows:

1. `POST <DEV_BASE_URL>/canvas/connect` with JSON body:
   `{"canvasBaseUrl":"https://canvas.example.edu","accessToken":"demo-token"}`
   - In demo mode without an authenticated principal, response may include `demoUserId`.
   - Pass that value as `X-Gurt-Demo-User-Id` on subsequent user-scoped requests
     (`/canvas/sync`, `/calendar/token`, `/courses`, `/study/*`) to keep data isolated.
2. `POST <DEV_BASE_URL>/canvas/sync`
   - Response includes `failedCourseIds` for per-course retry visibility.
   - Response includes KB trigger diagnostics:
     - `knowledgeBaseIngestionStarted`
     - `knowledgeBaseIngestionJobId`
     - `knowledgeBaseIngestionError`
   - Current live scope syncs:
     - published assignments with non-null due dates
     - published/visible course files (materials metadata + S3 mirror)
   - If KB env vars are configured and files are mirrored, sync automatically starts a Bedrock ingestion job.
3. Mint calendar token and fetch `/calendar/{token}.ics`.

Docs ingest workflow (Step Functions + PyMuPDF/Textract fallback + Bedrock KB):

1. Upload source file via `POST /uploads` and complete S3 `PUT`.
2. Start ingest: `POST /docs/ingest` with `{docId, courseId, key}`.
3. Poll ingest status: `GET /docs/ingest/{jobId}` until `status` is `FINISHED` or `FAILED`.
4. For `.pptx`, `.docx`, and `.doc` uploads, extract step converts to PDF first (stored back to S3), then runs extraction against converted PDF.
5. If PyMuPDF extraction yields fewer than 200 chars, workflow falls back to async Textract OCR.
6. `.pptx`, `.docx`, and `.doc` uploads require `contentLengthBytes` and must be <= 50MB.
7. On successful finalize, Bedrock Knowledge Base `StartIngestionJob` is triggered automatically (no manual CLI) when `KNOWLEDGE_BASE_ID` and `KNOWLEDGE_BASE_DATA_SOURCE_ID` are configured.
8. Status response may include `kbIngestionJobId` (when trigger succeeded) or `kbIngestionError` (when trigger failed) for traceability.

Ingest finalize and KB trigger operational metrics:

- CloudWatch namespace: `Gurt/IngestWorkflow`
- Stable dimensions (all metrics):
  - `Service=StudyBuddy`
  - `Workflow=DocsIngest`
  - `Handler=Finalize`
  - `Environment=<APP_ENV|STAGE|ENV|unknown>`
- Metric names (all `Count`):
  - `IngestFinalizeSuccess` (emitted when finalize persists `FINISHED`)
  - `IngestFinalizeFailure` (emitted when finalize persists `FAILED`)
  - `IngestKbTriggerMissingConfig` (emitted when finalize is `FINISHED` but KB ids are missing)
  - `IngestKbTriggerStarted` (emitted immediately before `StartIngestionJob`)
  - `IngestKbTriggerSucceeded` (emitted after `StartIngestionJob` returns successfully)
  - `IngestKbTriggerFailed` (emitted when `StartIngestionJob` raises)
- Suggested alert thresholds:
  - `IngestKbTriggerMissingConfig >= 1` for 10 minutes in non-local environments (critical misconfiguration).
  - `IngestKbTriggerFailed >= 3` in 15 minutes (warning), `>= 10` in 15 minutes (critical).
  - Finalize failure ratio > 5% over 30 minutes using metric math:
    `IngestFinalizeFailure / (IngestFinalizeSuccess + IngestFinalizeFailure)`.
  - Trigger failure ratio > 10% over 30 minutes using metric math:
    `IngestKbTriggerFailed / (IngestKbTriggerSucceeded + IngestKbTriggerFailed)`.

## CDK infra synth and deploy (demo scaffold)

Infrastructure is scaffolded in `infra/` with `GurtDataStack`, `GurtKnowledgeBaseStack`, and `GurtApiStack`.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r infra/requirements.txt
cd infra
cdk synth
cdk deploy GurtDataStack GurtKnowledgeBaseStack GurtApiStack
```

Or use one command from repo root (build + CDK checks + bootstrap + deploy):

```bash
./scripts/deploy.sh
```

Recommended usage with AWS SSO profile:

```bash
AWS_PROFILE=<your-sso-profile> ./scripts/deploy.sh
```

If generation/chat endpoints should hit a real Bedrock KB and Canvas sync should auto-start KB ingestion, pass:

```bash
AWS_PROFILE=<your-sso-profile> \
KNOWLEDGE_BASE_ID=<kb-id> \
KNOWLEDGE_BASE_DATA_SOURCE_ID=<data-source-id> \
./scripts/deploy.sh
```

By default, CDK now provisions a Bedrock guardrail and published version in `GurtApiStack`
and wires them into runtime env vars automatically.

If you already have a guardrail and do not want CDK to create one, pass your existing ID/version:

```bash
BEDROCK_GUARDRAIL_ID=<guardrail-id> \
BEDROCK_GUARDRAIL_VERSION=<version-or-DRAFT>
```

If `KNOWLEDGE_BASE_ID` is omitted, CDK provisions a Bedrock Knowledge Base stack automatically.

Optional override for CDK CLI package/version:

```bash
CDK_CLI_PACKAGE=aws-cdk@latest ./scripts/deploy.sh
```

Key stack outputs to use for smoke/dev secrets:

- `ApiBaseUrl` (or `SuggestedSmokeBaseUrlSecret`) -> `DEV_BASE_URL`
- `CalendarTokenMintEndpoint` -> call this endpoint to mint `DEV_CALENDAR_TOKEN`
- `SuggestedSmokeCourseIdSecret` -> `DEV_COURSE_ID` (defaults to `course-psych-101`)
- `BedrockGuardrailId` and `BedrockGuardrailVersion` (from `GurtApiStack`) -> runtime guardrail configuration
- `BedrockGuardrailMode` (`cdk-managed` or `existing`) -> indicates whether CDK created the guardrail
- `KnowledgeBaseId` (from `GurtKnowledgeBaseStack`) -> runtime `KNOWLEDGE_BASE_ID`
- `KnowledgeBaseDataSourceId` -> for `aws bedrock-agent start-ingestion-job`

CDK context defaults for demo deploys (`infra/cdk.json`):

- `bedrockModelId`: default model id for generation/chat (`us.anthropic.claude-sonnet-4-6`)
- `bedrockGuardrailId`: optional existing Bedrock guardrail id override; when empty, CDK creates one
- `bedrockGuardrailVersion`: optional existing guardrail version override; if id is set and version is empty, runtime uses `DRAFT`
- `embeddingModelId`: default embedding model for KB indexing (`amazon.titan-embed-text-v2:0`)
- `knowledgeBaseId`: optional existing KB ID override; when empty, CDK creates one
- `knowledgeBaseDataSourceId`: optional existing KB data source ID override (required for auto-ingestion trigger on `/canvas/sync`)
- `calendarToken`: default seeded token used by `/calendar/{token}.ics`
- `calendarTokenUserId`: optional seeded user lock for calendar feed requests
- `calendarFixtureFallback`: when `1`, `/calendar/{token}.ics` falls back to fixture events only when the token user is `DEMO_USER_ID` and that user has no schedule rows (demo-only behavior)
- `canvasSyncScheduleHours`: EventBridge periodic sync cadence for all stored Canvas connections (default `24`)

Where to add them in GitHub:

1. Open the repo on GitHub.
2. Go to **Settings** -> **Secrets and variables** -> **Actions**.
3. Under **Repository secrets**, click **New repository secret** and add each value above.

## Fixture usage before full implementation

- `fixtures/*.json` is the shared deterministic data layer for frontend stubs and backend placeholder handlers.
- Smoke tests and mock mode use the same fixture files to keep integration behavior stable.
- This avoids product logic coupling while teams build lambdas independently.

## Frontend client checks (local)

Runs typed API client tests and lightweight source linting for `src/api`.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Frontend browser shell (local)

Run the Next.js demo shell that calls the typed API client:

```bash
npm run dev
```

Then open `http://localhost:3000`.

Notes:

- Node.js must be `>=18.18.0` (recommended: Node 20 LTS).
- No frontend env vars are required for fixture mode.
- Product dashboard at `/` intentionally hides runtime controls.
- Runtime/API controls are available at `/dev-tools` for internal debugging.
- Use these only for live API calls:

```bash
export NEXT_PUBLIC_API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com/dev"
export NEXT_PUBLIC_USE_FIXTURES="false"
npm run dev
```

If browser calls fail with `Failed to fetch`, verify deployed API has CORS enabled (OPTIONS preflight + response headers) and that `NEXT_PUBLIC_API_BASE_URL` matches the deployed stage URL exactly.

## S3 upload CORS origin config (presigned upload URL)

`POST /uploads` returns a presigned S3 upload URL. Browser upload CORS is enforced by the uploads bucket CORS policy (not API Gateway CORS), so keep API Gateway CORS settings unchanged when debugging upload preflight issues.

`infra/app.py` reads `FRONTEND_ALLOWED_ORIGINS` as a comma-separated list and passes it to `GurtDataStack` for S3 CORS.
Default when unset or empty: `http://localhost:3000`.

Example (localhost + CloudFront follow-up origin):

```bash
export FRONTEND_ALLOWED_ORIGINS="http://localhost:3000,https://d123example.cloudfront.net"
AWS_PROFILE=<your-sso-profile> ./scripts/deploy.sh
```

Explicit preflight verification against a returned presigned upload URL:

```bash
UPLOAD_URL="$(curl -sS -X POST "$BASE_URL/uploads" \
  -H 'content-type: application/json' \
  -d '{"courseId":"course-psych-101","filename":"cors-check.txt","contentType":"text/plain"}' | jq -r '.uploadUrl')"

curl -i -X OPTIONS "$UPLOAD_URL" \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type'
```

Expected preflight headers include:
- `Access-Control-Allow-Origin: http://localhost:3000`
- `Access-Control-Allow-Methods` includes `PUT, GET, HEAD`
- `Access-Control-Allow-Headers` allows `*`

For completed upload `PUT` responses, `ETag` should be exposed to the browser via CORS.

Quick runtime-hardening checks in browser:

1. Use `Live API` mode, run `Connect Canvas`, then run `Sync Canvas` (primary ingest flow).
2. Confirm the Status panel `Ingest (Canvas-first)` block shows:
   - last successful sync time with mirrored material counts
   - any `failedCourseIds` warning from partial syncs
3. Confirm the same block reports **Knowledge Base Ingestion** outcome from Canvas sync:
   - `KB ingestion started (jobId: ...)` when mirrored materials were found and KB env vars are configured.
   - `KB ingestion not started: ...` when mirrored materials were found but KB start failed/misconfigured.
   - `No new mirrored materials.` when sync did not mirror any new files.
4. Force a Canvas sync failure (for example invalid token) and confirm actionable retry:
   - `Canvas sync failed: ...` appears
   - `Retry Canvas Sync` is available in both controls and Status panel
5. Optional fallback check for manual ingest support:
   - Expand `Manual /docs/ingest fallback (advanced)`.
   - Run `Start Manual Ingest` with `docId` + S3 `key`.
   - Confirm loading overlay while polling and status progression in `Manual Docs Ingest (Fallback)`.
   - Terminal state is `FINISHED` or actionable `FAILED` error with `Retry Manual Ingest`.
6. Run `Generate Cards`, `Generate Exam`, and `Ask Chat`; confirm each action reports success timestamps or actionable retry errors.

## Chrome extension API validation (demo)

Use the same deployed `/chat` endpoint as the web UI. There is no extension-only backend route in this phase.

- Compatibility doc: `docs/EXTENSION_COMPATIBILITY.md`
- Quick check:

```bash
curl -sS -X POST "$BASE_URL/chat" \
  -H 'content-type: application/json' \
  -d '{"courseId":"course-psych-101","question":"Summarize upcoming deadlines."}' | jq
```

## Chrome extension module scrape fallback validation

Use this runbook when Canvas file API sync is unreliable and extension fallback ingestion from module pages is required.

1. Load the extension in Chrome:
   - Open `chrome://extensions`.
   - Enable **Developer mode**.
   - Click **Load unpacked** and select `browserextention/`.
2. Open the target Canvas modules page:
   - Navigate to `https://<canvas-host>/courses/<courseId>/modules`.
   - Confirm the page has module file entries to scrape.
3. Run scrape from the extension:
   - Open the side panel for the page.
   - Trigger the module scrape/fallback action.
4. Verify extension summary counters:
   - `discovered`: file candidates found on `/courses/{id}/modules`.
   - `uploaded`: candidates that successfully completed `POST /uploads` + S3 `PUT`.
   - `ingest-started`: uploaded files that successfully started `POST /docs/ingest` (`202`).
   - `skipped`: candidates intentionally not processed (unsupported type, duplicate, or missing required metadata/link).
   - `failed`: candidates that attempted processing but failed during download, upload, or ingest start.
5. Validate counter consistency:
   - `uploaded <= discovered`
   - `ingest-started <= uploaded`
   - At completion, each discovered candidate should be classified into upload/skip/fail buckets by extension policy.
6. Validate ingest jobs for started items:
   - For each started job, poll `GET /docs/ingest/{jobId}` until `FINISHED` or `FAILED`.
   - Record failed jobs with `jobId` + file name for retry triage.
7. Validate backend route usage:
   - Expected per-file sequence: `POST /uploads` -> signed S3 `PUT` -> `POST /docs/ingest`.
   - No extension-only ingest endpoint should appear in network logs.

## Chrome extension focus blocking validation (MVP)

Use this runbook to validate LeechBlock-style website blocking in the extension service worker.

1. Load the extension in Chrome:
   - Open `chrome://extensions`.
   - Enable **Developer mode**.
   - Click **Load unpacked** and select `browserextention/`.
2. Open extension options page and configure blocking:
   - Enable website blocking.
   - Add a site pattern (for example `reddit.com`).
   - Configure an active time window (for example `0000-2400`) and active day.
   - Save settings.
3. Validate blocked-page redirect:
   - Navigate to a blocked site.
   - Confirm tab redirects to extension `blocked.html` with reason and next-unblock details.
4. Validate hard allowlist behavior:
   - Navigate to `https://canvas.calpoly.edu/...`.
   - Confirm it is never redirected to blocked page with default config.
5. Validate side panel controls:
   - Open side panel and locate `Focus Blocking` card.
   - Confirm status text renders enabled/blocked state.
   - Toggle blocking off and verify blocked pages can be revisited.
6. Validate schedule/limit semantics:
   - With schedule-only config, confirm block occurs only inside configured time ranges.
   - With limit-only config, confirm block starts after exceeding configured minutes in period.
7. Validate Pomodoro semantics:
   - Enable Pomodoro in options with custom focus/break durations.
   - Start Pomodoro from sidepanel `Focus Blocking` card.
   - Confirm session cannot be manually stopped before the cycle completes.
   - Confirm matched sites are blocked during focus phase and unblocked during break phase.
   - Confirm blocked page countdown reaches `00:00` and page refreshes.
8. Validate release readiness allowlist note:
   - Confirm options UI reminder exists to include final CloudFront web app domain in hard allowlist before production release.
