# Testing and Contract Scaffolding

This repository includes contract-first API assets, deterministic fixtures, and smoke tooling for parallel backend/frontend development.

## Local setup

```bash
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
npm install
```

## Contract checks (local)

Runs OpenAPI syntax validation and example-vs-schema validation.

```bash
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
python scripts/test_uploads.py
```

## Smoke tests (local, mock mode)

Runs the full smoke sequence without deployed lambdas by serving fixture-backed endpoints from an in-process mock server.

```bash
SMOKE_MOCK_MODE=1 python scripts/run_smoke_tests.py
```

## Smoke tests (local, deployed API)

Use this mode against API Gateway/Lambda environments.

```bash
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

1. Call `POST <DEV_BASE_URL>/calendar/token` as an authenticated caller.
2. Copy the `token` from the JSON response.
3. Save that token in GitHub Actions secret `DEV_CALENDAR_TOKEN`.

In the current CDK scaffold, `POST /calendar/token` uses IAM auth (`AuthorizationType.IAM`),
so call it with AWS credentials that can sign SigV4 requests.

## CDK infra synth and deploy (demo scaffold)

Infrastructure is scaffolded in `infra/` with `GurtDataStack` and `GurtApiStack`.

```bash
python -m pip install --upgrade pip
pip install -r infra/requirements.txt
cd infra
cdk synth
cdk deploy GurtDataStack GurtApiStack
```

Or use one command from repo root (build + CDK checks + bootstrap + deploy):

```bash
./scripts/deploy.sh
```

Key stack outputs to use for smoke/dev secrets:

- `ApiBaseUrl` (or `SuggestedSmokeBaseUrlSecret`) -> `DEV_BASE_URL`
- `CalendarTokenMintEndpoint` -> call this endpoint to mint `DEV_CALENDAR_TOKEN`
- `SuggestedSmokeCourseIdSecret` -> `DEV_COURSE_ID` (defaults to `course-psych-101`)

CDK context defaults for demo deploys (`infra/cdk.json`):

- `calendarToken`: default seeded token used by `/calendar/{token}.ics`
- `calendarTokenUserId`: optional seeded user lock for calendar feed requests

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
