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

## Smoke tests (local, mock mode)

Runs the full smoke sequence without deployed lambdas by serving fixture-backed endpoints from an in-process mock server.

```bash
source .venv/bin/activate
SMOKE_MOCK_MODE=1 python scripts/run_smoke_tests.py
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

## Smoke tests against dev stage (GitHub Actions)

Run the **Smoke Dev** workflow manually (`workflow_dispatch`) with these repository secrets:

- `DEV_BASE_URL` (required)
- `DEV_CALENDAR_TOKEN` (required)
- `DEV_COURSE_ID` (optional; defaults to `course-psych-101` when empty)

How to get `DEV_CALENDAR_TOKEN`:

1. Call `POST <DEV_BASE_URL>/calendar/token`.
2. Copy the `token` from the JSON response.
3. Save that token in GitHub Actions secret `DEV_CALENDAR_TOKEN`.

In the current demo scaffold, `POST /calendar/token` is intentionally `AuthorizationType.NONE`
because org SCP policies may deny `execute-api:Invoke`. Runtime falls back to `DEMO_USER_ID` when
no authenticated principal is present and `DEMO_MODE=true`.

Canvas bootstrap for demo schedule rows:

1. `POST <DEV_BASE_URL>/canvas/connect` with JSON body:
   `{"canvasBaseUrl":"https://canvas.example.edu","accessToken":"demo-token"}`
2. `POST <DEV_BASE_URL>/canvas/sync`
   - Response includes `failedCourseIds` for per-course retry visibility.
   - Current live scope syncs published assignments with non-null due dates.
3. Mint calendar token and fetch `/calendar/{token}.ics`.

Docs ingest workflow (Step Functions + PyMuPDF/Textract fallback):

1. Upload source file via `POST /uploads` and complete S3 `PUT`.
2. Start ingest: `POST /docs/ingest` with `{docId, courseId, key}`.
3. Poll ingest status: `GET /docs/ingest/{jobId}` until `status` is `FINISHED` or `FAILED`.
4. If PyMuPDF extraction yields fewer than 200 chars, workflow falls back to async Textract OCR.

## CDK infra synth and deploy (demo scaffold)

Infrastructure is scaffolded in `infra/` with `GurtDataStack` and `GurtApiStack`.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r infra/requirements.txt
cd infra
cdk synth
cdk deploy GurtDataStack GurtApiStack
```

Or use one command from repo root (build + CDK checks + bootstrap + deploy):

```bash
./scripts/deploy.sh
```

Recommended usage with AWS SSO profile:

```bash
AWS_PROFILE=<your-sso-profile> ./scripts/deploy.sh
```

If generation/chat endpoints should hit a real Bedrock KB, also pass:

```bash
AWS_PROFILE=<your-sso-profile> KNOWLEDGE_BASE_ID=<kb-id> ./scripts/deploy.sh
```

Optional override for CDK CLI package/version:

```bash
CDK_CLI_PACKAGE=aws-cdk@latest ./scripts/deploy.sh
```

Key stack outputs to use for smoke/dev secrets:

- `ApiBaseUrl` (or `SuggestedSmokeBaseUrlSecret`) -> `DEV_BASE_URL`
- `CalendarTokenMintEndpoint` -> call this endpoint to mint `DEV_CALENDAR_TOKEN`
- `SuggestedSmokeCourseIdSecret` -> `DEV_COURSE_ID` (defaults to `course-psych-101`)

CDK context defaults for demo deploys (`infra/cdk.json`):

- `bedrockModelId`: default model id for generation/chat (`us.anthropic.claude-sonnet-4-6`)
- `knowledgeBaseId`: Bedrock Knowledge Base ID used by `/generate/*` and `/chat` retrieval
- `calendarToken`: default seeded token used by `/calendar/{token}.ics`
- `calendarTokenUserId`: optional seeded user lock for calendar feed requests
- `calendarFixtureFallback`: when `1`, `/calendar/{token}.ics` falls back to fixture events if user schedule rows are empty (demo-only behavior)
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
npm run lint
npm test
```

## Frontend browser shell (local)

Run the Next.js demo shell that calls the typed API client:

```bash
export NEXT_PUBLIC_API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com/dev"
export NEXT_PUBLIC_USE_FIXTURES="true"   # switch to false for live API calls
npm run dev
```

Then open `http://localhost:3000`.
