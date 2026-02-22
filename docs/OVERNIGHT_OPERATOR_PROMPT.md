# Overnight Operator Prompt (Current Repo Version)

Copy/paste this prompt into each Codex thread for overnight autonomous execution.

## Prompt

```text
Overnight Operator Mode (48h Hackathon)

You are operating autonomously on this thread until I return.

Objective
- Complete as much of this issue as possible with production-safe changes.
- Stay on this issue's scope. Do not start unrelated refactors.

Repo/Process Rules (must follow)
- Work on branch: <BRANCH_NAME> (must be one of: feature/*, fix/*, chore/*, docs/*)
- Use Conventional Commits.
- Atomic commits only (one logical change per commit).
- Auto-commit directly when checks pass (do not wait for per-commit approval).
- You may push branch updates, but only after required local checks pass.
- Never commit secrets/tokens/credentials.

Environment Setup (once per fresh machine/session)
- python3 -m venv .venv
- source .venv/bin/activate
- python -m pip install --upgrade pip
- python -m pip install -r requirements-dev.txt
- npm ci (needed when frontend/PR checks will run)

Required Local Verification (AGENTS minimum)
- python scripts/validate_contracts.py
- SMOKE_MOCK_MODE=1 python scripts/run_smoke_tests.py
- python -m pytest -q (if unit tests exist)
- ./scripts/check-cdk.sh (only if infra/** changed)

PR-Readiness Gate (align to current CI workflow)
- Before marking a PR ready (or after major changes), run:
  - npm run typecheck
  - npm run lint
  - npm test
  - npm run build
  - python scripts/validate_contracts.py
  - python -m pytest -q
  - ./scripts/check-cdk.sh (only if infra/** changed)
  - SMOKE_MOCK_MODE=1 MINT_CALENDAR_TOKEN=1 SMOKE_INCLUDE_CANVAS_SYNC=1 SMOKE_INCLUDE_CHAT=1 SMOKE_INCLUDE_INGEST=1 python scripts/run_smoke_tests.py
- If any PR CI check fails after push, diagnose and fix, then re-run/push until green or a true blocker is hit.

Contract-First Rules (if API behavior/payload/endpoints change)
1) contracts/openapi.yaml
2) contracts/schemas/*.json
3) contracts/examples/*.json
4) fixtures/*.json when smoke assumptions/response shapes change
5) docs/OVERVIEW.md if architecture/scope changed
6) docs/TESTING.md if test workflow changed

Autonomous Execution Loop
1) Inspect current issue state and failures.
2) Run required local verification commands.
3) If a check fails:
   - Find root cause.
   - Implement the smallest correct fix.
   - Re-run relevant checks, then full required checks.
4) Commit passing fixes immediately with Conventional Commit messages.
5) Push when local required checks are passing.
6) If PR exists/is created, monitor CI and fix until green.
7) Repeat until completion or true blocker.

No-Idle Continuation Rule (highest priority)
- Never pause for a checkpoint, handoff, or "awaiting confirmation" after a status update, commit, PR, merge, or smoke validation.
- If there is no blocker, immediately pull the next queued task/branch and continue execution.
- Status messages are non-blocking heartbeats only; do not wait for a reply.
- Only stop and wait when one of these is true:
  1) missing credentials/access
  2) destructive action requires explicit approval
  3) true product ambiguity with multiple valid outcomes and no written decision rule
- If none of the above apply, continue autonomously until the run window ends.

Progress + Reporting
- Post a concise status update every 60 minutes including:
  - current task
  - latest local checks + CI status
  - next action
- Keep a running Night Log in-thread with:
  - commits made
  - checks run + results
  - pushes/CI outcomes
  - blockers
- After each hourly status post, continue work immediately in the same run loop.

Blocker Policy
- Continue autonomously unless blocked by:
  - missing credentials/secrets/access
  - ambiguous product decision with multiple valid outcomes
  - destructive/unsafe action requiring approval
- If blocked >15 minutes:
  - report exact command/error and why blocked
  - propose 1-2 concrete options
  - move to highest-value fallback task within this same issue scope:
    - add/fix tests for touched code
    - tighten contract/examples/fixtures alignment
    - small docs updates required by changes
    - cleanup directly related to this issue only

Safety Constraints
- Never run destructive commands (e.g., reset --hard) unless explicitly approved.
- Do not revert unrelated changes from other developers.
- If unexpected unrelated file changes appear in files you need to touch, pause and report before proceeding there.

Finish Condition
- Required local checks pass and pushed branch is in good state, OR blocker is clearly documented.
- If PR is involved, all required CI checks are green, OR blocker clearly documented.
- Post final overnight summary:
  - completed work
  - remaining work
  - exact next step
  - touched files
  - commits
  - latest local check results
  - latest CI status
```

## Why this version is current

- Keeps AGENTS minimum local loop intact.
- Adds explicit PR-readiness checks that match current `.github/workflows/ci.yml`.
- Uses the expanded smoke test env flags currently run in CI.
- Retains the no-idle continuation rule so Codex does not stop at checkpoints.
