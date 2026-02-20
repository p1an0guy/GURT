# AGENTS.md

## Purpose
This file is strict policy for all contributors and agents working in parallel on GURT (StudyBuddy). Keep it lean and update it as development decisions change.

## Stack Context
- Backend: Python with `boto3`, deployed on AWS serverless infrastructure (API Gateway + Lambda).
- IaC: AWS CDK in Python.
- Data/storage: DynamoDB + S3.
- Frontend: React/Next.js, deployed on AWS services.
- AI provider: Amazon Bedrock.
- Hackathon auth scope: no end-user login/auth yet; Canvas token auth for data sync remains in scope.

## Source of Truth
- Architecture and scope source of truth: `docs/OVERVIEW.md`.
- API contract source of truth: `contracts/openapi.yaml` and `contracts/schemas/*.json`.
- Deterministic shared test data source of truth: `fixtures/*.json`.

## Required Branching Policy
- Every feature/fix/chore must be developed on its own branch.
- Branch names must use one of these prefixes:
  - `feature/<short-description>`
  - `fix/<short-description>`
  - `chore/<short-description>`
  - `docs/<short-description>`
- Do not commit feature work directly to `main`.

## Required Commit Policy
- Use Conventional Commits (for example `feat: ...`, `fix: ...`, `chore: ...`).
- Make atomic commits: each commit should represent one logical change.
- Commit early and often to preserve rollback safety.

## API Contract Rules (Non-Negotiable)
- Contract-first development is mandatory for API changes.
- Any API payload or endpoint change must update contracts before or with implementation.
- Do not break existing API contracts without explicit human approval.
- Keep OpenAPI paths, schemas, and examples aligned in the same PR.
- Respect schema strictness (`additionalProperties: false`).
- Required fields must always be present.
- Use RFC3339 UTC timestamps with trailing `Z` (example `2026-09-01T10:15:00Z`).

## Test and Merge Gates (Non-Negotiable)
- Smoke tests are required before merge.
- Contract checks are required before merge.
- Minimum local verification commands:

```bash
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
python scripts/validate_contracts.py
SMOKE_MOCK_MODE=1 python scripts/run_smoke_tests.py
```

- If unit tests exist, run:

```bash
python -m pytest -q
```

- CI workflows:
  - `.github/workflows/ci.yml`
  - `.github/workflows/smoke-dev.yml`

## Fixture Policy
- Update fixtures when behavior changes impact smoke assumptions or contract-shaped responses.
- Keep fixture-backed behavior deterministic for parallel development and CI reproducibility.

## Security Rules
- Never commit secrets, tokens, API keys, or credentials.
- Never place secrets in fixtures, test data, logs, screenshots, or docs.
- Use environment variables and GitHub Actions secrets for sensitive values.

## Docs Update Rules
- `docs/OVERVIEW.md` must be updated whenever architecture or scope changes.
- `docs/TESTING.md` must be updated whenever developer test workflow changes.

## PR Process
- PR size is not capped.
- Codex is used to review PRs, handle merge conflicts, and auto-merge only after required checks pass.
- No fixed PR template is required.

## Contract Change Checklist
When modifying API behavior or shapes, update all relevant files in one PR:
1. `contracts/openapi.yaml`
2. `contracts/schemas/*.json` (as needed)
3. `contracts/examples/*.json` (as needed)
4. `fixtures/*.json` when smoke assumptions or response shapes change
5. `docs/OVERVIEW.md` when architecture/scope changes
6. `docs/TESTING.md` when test workflow changes

## Current API Surface (High-level)
- `GET /health`
- `GET /courses`
- `GET /courses/{courseId}/items`
- `GET /study/today?courseId=...`
- `POST /study/review`
- `GET /study/mastery?courseId=...`
- `GET /calendar/{token}.ics`
