# Cost Optimization Worktree Execution Tracker

Integration branch: `codex/feature/cost-optimization`

## Parallel Worktree Map

| Agent | Task | Branch | Worktree |
|---|---|---|---|
| A1 | Task 1 (S3 vectors) | `codex/feature/cost-opt-task1-s3-vectors` | `/home/jchan/dev/GURT-worktrees/task1-s3-vectors` |
| A2 | Task 2 (backend guardrails) | `codex/feature/cost-opt-task2-backend-guardrails` | `/home/jchan/dev/GURT-worktrees/task2-backend-guardrails` |
| A3 | Task 3 (Haiku generation) | `codex/feature/cost-opt-task3-haiku-generation` | `/home/jchan/dev/GURT-worktrees/task3-haiku-generation` |
| A4 | Task 4 (skip FM parsing) | `codex/feature/cost-opt-task4-skip-fm-parsing` | `/home/jchan/dev/GURT-worktrees/task4-skip-fm-parsing` |
| A5 | Task 5 (CDK guardrails, after Task 2) | `codex/feature/cost-opt-task5-cdk-guardrails` | `/home/jchan/dev/GURT-worktrees/task5-cdk-guardrails` |

## Dependency Order

1. Run Tasks 1-4 in parallel.
2. Create Task 5 branch from Task 2 branch head, then implement Task 5.
3. Merge Task branches into `codex/feature/cost-optimization`.
4. Run Task 6 integration validation.

## To-Do Checklist (mirrors 2026-03-04-cost-optimization.md)

### Task 1: Replace OpenSearch Serverless with S3 as KB Vector Store
- [x] Step 1: Read current KB stack OpenSearch dependency chain.
- [x] Step 2: Replace OpenSearch section with S3 vector store configuration.
- [x] Step 3: Remove OpenSearch-specific imports and index-creator code.
- [x] Step 4: Remove OpenSearch-specific IAM policy from KB service role.
- [x] Step 5: Remove OpenSearch-specific CfnOutputs.
- [x] Step 6: Run CDK synth validation.
- [x] Step 7: Commit Task 1.

### Task 2: Remove Bedrock Guardrails from Backend Code
- [x] Step 1: Verify regex-based safety tests still pass.
- [x] Step 2: Remove guardrail helper functions from `backend/generation.py`.
- [x] Step 3: Remove guardrail kwargs from `_invoke_model_json`.
- [x] Step 4: Remove guardrail kwargs from `_invoke_model_multimodal_json`.
- [x] Step 5: Remove guardrail config/intervention calls from `_retrieve_and_generate`.
- [x] Step 6: Remove guardrail invocation test classes.
- [x] Step 7: Run all generation tests.
- [x] Step 8: Commit Task 2.

### Task 3: Use Haiku for Flashcard and Practice Exam Generation
- [x] Step 1: Add `GENERATION_MODEL_ID` model split design.
- [x] Step 2: Add failing tests for `_invoke_model_json` model selection.
- [x] Step 3: Run tests and confirm failure.
- [x] Step 4: Implement `GENERATION_MODEL_ID` preference in `_invoke_model_json`.
- [x] Step 5: Re-run tests and confirm pass.
- [x] Step 6: Wire `GENERATION_MODEL_ID` in `infra/app.py` and `infra/stacks/api_stack.py`; set flashcard model to same generation model.
- [x] Step 7: Run generation tests and CDK synth.
- [x] Step 8: Commit Task 3.

### Task 4: Skip FM-Based KB Document Parsing
- [x] Step 1: Remove FM parsing configuration and model IAM policy from KB data source.
- [x] Step 2: Run CDK synth validation.
- [x] Step 3: Commit Task 4.

### Task 5: Remove Bedrock Guardrails from CDK Stack (depends on Task 2)
- [x] Step 1: Remove guardrail resource creation from `ApiStack`.
- [x] Step 2: Remove guardrail params from `ApiStack.__init__`.
- [x] Step 3: Remove guardrail env vars from Lambda environments.
- [x] Step 4: Remove guardrail CfnOutputs.
- [x] Step 5: Remove guardrail context vars/wiring from `infra/app.py`.
- [x] Step 6: Remove unused `aws_bedrock` import from `api_stack.py`.
- [x] Step 7: Run CDK synth.
- [x] Step 8: Commit Task 5.

### Task 6: Integration Validation (depends on Tasks 1-5)
- [x] Step 1: Run full test suite.
- [x] Step 2: Run CDK synth for all stacks.
- [x] Step 3: Verify no guardrail runtime plumbing references remain.
- [x] Step 4: Verify OpenSearch references removed from KB stack.
- [x] Step 5: Verify `GENERATION_MODEL_ID`/Haiku wiring.
- [x] Step 6: Merge branches and finalize integration commit.
