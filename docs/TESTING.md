# Testing and Contract Scaffolding

This repository includes contract-first API assets, deterministic fixtures, and smoke tooling for parallel backend/frontend development.

## Local setup

```bash
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
```

## Contract checks (local)

Runs OpenAPI syntax validation and example-vs-schema validation.

```bash
python scripts/validate_contracts.py
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
- `DEV_COURSE_ID` (optional)

## Fixture usage before full implementation

- `fixtures/*.json` is the shared deterministic data layer for frontend stubs and backend placeholder handlers.
- Smoke tests and mock mode use the same fixture files to keep integration behavior stable.
- This avoids product logic coupling while teams build lambdas independently.
