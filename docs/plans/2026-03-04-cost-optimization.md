# GURT Cost Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce per-user AWS cost from ~$9/user/month to ~$5/user/month by eliminating OpenSearch Serverless, removing Bedrock Guardrails, using Haiku for generation, and skipping FM-based KB parsing.

**Architecture:** Six independent changes that each reduce a specific cost component. Tasks 1-4 are fully independent and can be parallelized across worktrees. Task 5 (CDK guardrail removal) depends on Task 2 (backend guardrail removal). Task 6 (integration test) depends on all others.

**Tech Stack:** Python 3.12, AWS CDK v2 (Python), Bedrock, OpenSearch Serverless, S3, pytest/unittest

---

## Parallel Execution Map

```
Task 1: S3 Vectors (KB stack)          ──┐
Task 2: Remove Guardrails (backend)     ──┤
Task 3: Haiku for gen (backend + CDK)   ──┼── Task 6: Integration validation
Task 4: Skip FM parsing (KB stack)      ──┤
Task 5: Remove Guardrails (CDK)  ←T2────┘
```

**Independent (can run in parallel):** Tasks 1, 2, 3, 4
**Sequential dependency:** Task 5 depends on Task 2; Task 6 depends on all

---

## Task 1: Replace OpenSearch Serverless with S3 as KB Vector Store

**Why:** OpenSearch Serverless has a 2-OCU minimum costing $345.60/month even idle. S3-backed vector storage eliminates this fixed cost entirely.

**Files:**
- Modify: `infra/stacks/knowledge_base_stack.py` (entire OpenSearch section: lines 165-290)
- Modify: `infra/app.py:33` (embedding model context)
- Test: `cdk synth` validation

**Step 1: Read current KB stack to understand the full OpenSearch dependency chain**

The current stack creates these OpenSearch resources (all to be removed):
- `CfnSecurityPolicy` (encryption) — line 165
- `CfnSecurityPolicy` (network) — line 184
- `CfnCollection` — line 210
- `CfnAccessPolicy` (data access) — line 240
- Custom Resource Lambda (`IndexCreatorFunction`) — line 222
- `CustomResource` (`VectorIndexCustomResource`) — line 279

And references them in the KB `storage_configuration` at line 327.

**Step 2: Replace the entire OpenSearch section with S3 vector store configuration**

Remove everything from line 165 through line 290 (the OpenSearch collection, security policies, access policies, index creator Lambda, and custom resource). Replace the `storage_configuration` block.

In `infra/stacks/knowledge_base_stack.py`, the new KnowledgeBase construct should use S3 vector store:

```python
knowledge_base = bedrock.CfnKnowledgeBase(
    self,
    "KnowledgeBase",
    name=knowledge_base_name,
    role_arn=kb_service_role.role_arn,
    description="StudyBuddy Bedrock Knowledge Base over uploaded course materials.",
    knowledge_base_configuration=bedrock.CfnKnowledgeBase.KnowledgeBaseConfigurationProperty(
        type="VECTOR",
        vector_knowledge_base_configuration=bedrock.CfnKnowledgeBase.VectorKnowledgeBaseConfigurationProperty(
            embedding_model_arn=embedding_model_arn,
            supplemental_data_storage_configuration=(
                bedrock.CfnKnowledgeBase.SupplementalDataStorageConfigurationProperty(
                    supplemental_data_storage_locations=[
                        bedrock.CfnKnowledgeBase.SupplementalDataStorageLocationProperty(
                            supplemental_data_storage_location_type="S3",
                            s3_location=bedrock.CfnKnowledgeBase.S3LocationProperty(
                                uri=parsed_content_uri,
                            ),
                        )
                    ],
                )
            ),
        ),
    ),
    storage_configuration=bedrock.CfnKnowledgeBase.StorageConfigurationProperty(
        type="S3",
    ),
)
```

Note: The S3 vector store type in Bedrock KB may require a specific CDK property structure. Check the CDK docs for `CfnKnowledgeBase.StorageConfigurationProperty` to confirm if `type="S3"` is the correct value or if there's a dedicated S3 vector store configuration property. The CDK L1 construct maps directly to CloudFormation — check the [AWS::Bedrock::KnowledgeBase StorageConfiguration](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-bedrock-knowledgebase-storageconfiguration.html) docs.

> **IMPORTANT:** S3 Vectors / S3 Tables support in Bedrock KB may still be in preview or require a specific region. Before implementing, verify availability by checking:
> 1. AWS Bedrock KB documentation for supported vector store types
> 2. CloudFormation resource spec for `AWS::Bedrock::KnowledgeBase` StorageConfiguration
> 3. If S3 vector store isn't yet supported in CDK/CloudFormation, the fallback is to keep OpenSearch Serverless but configure it with the minimum possible OCUs, or use Amazon Aurora PostgreSQL with pgvector as the vector store (also supported by Bedrock KB, and much cheaper than OpenSearch Serverless at low scale).

**Step 3: Remove OpenSearch-specific imports**

In `knowledge_base_stack.py`, remove:
```python
from aws_cdk import aws_opensearchserverless as aoss
```

Also remove the entire `_INDEX_CREATOR_CODE` string constant (lines 29-126) and the `aws_lambda` import if no longer needed.

**Step 4: Remove the OpenSearch-specific IAM policy from the KB service role**

Remove this block (lines 294-299):
```python
kb_service_role.add_to_policy(
    iam.PolicyStatement(
        actions=["aoss:APIAccessAll"],
        resources=["*"],
    )
)
```

**Step 5: Remove OpenSearch-specific CfnOutputs**

Remove the `KnowledgeBaseCollectionArn` output (lines 413-418) since there's no longer a collection.

**Step 6: Run CDK synth to validate**

Run: `cd /home/jchan/dev/GURT/infra && cdk synth --quiet 2>&1 | head -50`

Expected: Successful synthesis with no OpenSearch resources in the template.

If `cdk synth` fails because S3 vector store type isn't supported, fall back to Aurora pgvector or keep OpenSearch Serverless and note this as a future optimization pending AWS support.

**Step 7: Commit**

```bash
git add infra/stacks/knowledge_base_stack.py
git commit -m "infra: replace OpenSearch Serverless with S3 vector store in KB stack

Eliminates the $345.60/month minimum OCU cost for the vector store.
S3-backed vector storage is pay-per-query with no minimum compute."
```

---

## Task 2: Remove Bedrock Guardrails from Backend Code

**Why:** Guardrails cost ~$1.00/1K text units on every request (11% of total cost). The existing regex-based safety checks in `generation.py` (`_PROMPT_INJECTION_PATTERNS`, `_CHEATING_PATTERNS`) already provide equivalent protection for this use case.

**Files:**
- Modify: `backend/generation.py:207-270` (guardrail functions)
- Modify: `backend/generation.py:450-503` (`_invoke_model_json` — remove guardrail kwargs)
- Modify: `backend/generation.py:515-571` (`_invoke_model_multimodal_json` — remove guardrail kwargs)
- Modify: `backend/generation.py:903-1000` (`_retrieve_and_generate` — remove guardrail config)
- Modify: `tests/test_generation.py:385-429` (guardrail invocation tests)
- Modify: `tests/test_generation.py:483-533` (retrieve_and_generate guardrail tests)

**Step 1: Write tests that verify the regex-based safety still works WITHOUT Bedrock Guardrails**

The existing tests in `GuardrailSafetyTests` (lines 349-382) already test `_enforce_question_safety()` regex patterns. Verify these still pass after removal. No new tests needed — just ensure the existing ones pass.

Run: `cd /home/jchan/dev/GURT && python -m pytest tests/test_generation.py::GuardrailSafetyTests -v`

Expected: All pass (they test regex patterns, not Bedrock Guardrails).

**Step 2: Remove Bedrock Guardrail helper functions from generation.py**

Remove these functions entirely (they will no longer be called):
- `_guardrail_settings()` (lines 207-217)
- `_guardrail_generation_configuration()` (lines 220-224)
- `_guardrail_intervened()` (lines 227-264)
- `_raise_if_guardrail_intervened()` (lines 267-269)

**Step 3: Remove guardrail kwargs from `_invoke_model_json`**

In `_invoke_model_json()` (line 450), remove lines 474-477:
```python
        guardrail_id, guardrail_version = _guardrail_settings()
        if guardrail_id and guardrail_version:
            invoke_kwargs["guardrailIdentifier"] = guardrail_id
            invoke_kwargs["guardrailVersion"] = guardrail_version
```

And remove line 487:
```python
    _raise_if_guardrail_intervened(payload)
```

**Step 4: Remove guardrail kwargs from `_invoke_model_multimodal_json`**

In `_invoke_model_multimodal_json()` (line 515), remove lines 544-547:
```python
        guardrail_id, guardrail_version = _guardrail_settings()
        if guardrail_id and guardrail_version:
            invoke_kwargs["guardrailIdentifier"] = guardrail_id
            invoke_kwargs["guardrailVersion"] = guardrail_version
```

And remove line 557:
```python
    _raise_if_guardrail_intervened(payload)
```

**Step 5: Remove guardrail config from `_retrieve_and_generate`**

In `_retrieve_and_generate()` (line 903), remove lines 936-938:
```python
        guardrail_config = _guardrail_generation_configuration()
        if guardrail_config is not None:
            generation_configuration["guardrailConfiguration"] = guardrail_config
```

And remove lines 970 and 992:
```python
        _raise_if_guardrail_intervened(response)
```
(two occurrences — one for filtered path, one for unfiltered fallback)

Keep the `GuardrailBlockedError` raise in the except blocks as-is — these should become dead code, but `_enforce_question_safety()` still raises `GuardrailBlockedError` for regex matches. The class and constant are still used.

**Step 6: Update tests — remove Bedrock Guardrail invocation tests**

In `tests/test_generation.py`:

Remove `BedrockGuardrailInvocationTests` class (lines 385-429) — these test that guardrail kwargs are passed to `invoke_model`, which we're removing.

Remove `RetrieveAndGenerateGuardrailTests` class (lines 483-533) — these test guardrail config in `retrieve_and_generate`.

Keep `GuardrailSafetyTests` class (lines 349-382) — these test the regex-based `_enforce_question_safety()` which remains.

**Step 7: Run all tests**

Run: `cd /home/jchan/dev/GURT && python -m pytest tests/test_generation.py -v`

Expected: All remaining tests pass. The regex safety tests (`GuardrailSafetyTests`) still pass. The removed test classes no longer run.

**Step 8: Commit**

```bash
git add backend/generation.py tests/test_generation.py
git commit -m "feat: remove Bedrock Guardrails from backend, keep regex safety

The regex-based _enforce_question_safety() provides equivalent
protection for prompt injection and cheating detection at zero cost.
Bedrock Guardrails added ~11% to monthly AWS cost."
```

---

## Task 3: Use Haiku 4.5 for Flashcard and Practice Exam Generation

**Why:** Flashcard/exam generation produces structured JSON where Haiku excels. Haiku 4.5 is 73% cheaper than Sonnet 4.5 ($0.80/$4.00 vs $3.00/$15.00 per 1M input/output tokens). Chat stays on Sonnet for quality.

**Files:**
- Modify: `backend/generation.py:450-457` (`_invoke_model_json` model selection)
- Modify: `backend/generation.py:515-528` (`_invoke_model_multimodal_json` model selection)
- Modify: `backend/practice_exam_workflow.py:42-58` (worker_handler model env)
- Modify: `infra/stacks/api_stack.py:225-243` (Lambda environment variables)
- Modify: `infra/stacks/api_stack.py:327-342` (FlashcardGenWorker env)
- Modify: `infra/stacks/api_stack.py:357-371` (PracticeExamGenWorker env)
- Test: `tests/test_generation.py`

**Step 1: Add `GENERATION_MODEL_ID` environment variable for gen-specific model**

The current code uses `BEDROCK_MODEL_ID` (Sonnet 4.5) for everything via `_invoke_model_json`, and `FLASHCARD_MODEL_ID` for multimodal flashcard gen. We need a clean separation:
- `BEDROCK_MODEL_ID` = Sonnet 4.5 (used by chat via `_retrieve_and_generate`)
- `GENERATION_MODEL_ID` = Haiku 4.5 (used by `_invoke_model_json` for KB-based flashcard/exam gen)
- `FLASHCARD_MODEL_ID` = Haiku 4.5 (used by `_invoke_model_multimodal_json` for material-based gen)

**Step 2: Write a failing test**

In `tests/test_generation.py`, add a test that verifies `_invoke_model_json` uses `GENERATION_MODEL_ID` when available:

```python
class GenerationModelSelectionTests(unittest.TestCase):
    @patch.dict(
        "os.environ",
        {
            "BEDROCK_MODEL_ID": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "GENERATION_MODEL_ID": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        },
        clear=False,
    )
    def test_invoke_model_json_prefers_generation_model_id(self) -> None:
        client = MagicMock()
        body = MagicMock()
        body.read.return_value = json.dumps(
            {"content": [{"type": "text", "text": '{"ok": true}'}]}
        ).encode("utf-8")
        client.invoke_model.return_value = {"body": body}

        with patch("backend.generation._bedrock_runtime", return_value=client):
            generation._invoke_model_json("Return json.")

        invoke_kwargs = client.invoke_model.call_args.kwargs
        self.assertEqual(
            invoke_kwargs["modelId"],
            "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        )

    @patch.dict(
        "os.environ",
        {"BEDROCK_MODEL_ID": "us.anthropic.claude-sonnet-4-5-20250929-v1:0"},
        clear=False,
    )
    def test_invoke_model_json_falls_back_to_bedrock_model_id(self) -> None:
        client = MagicMock()
        body = MagicMock()
        body.read.return_value = json.dumps(
            {"content": [{"type": "text", "text": '{"ok": true}'}]}
        ).encode("utf-8")
        client.invoke_model.return_value = {"body": body}

        with patch("backend.generation._bedrock_runtime", return_value=client):
            generation._invoke_model_json("Return json.")

        invoke_kwargs = client.invoke_model.call_args.kwargs
        self.assertEqual(
            invoke_kwargs["modelId"],
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        )
```

**Step 3: Run tests to verify they fail**

Run: `cd /home/jchan/dev/GURT && python -m pytest tests/test_generation.py::GenerationModelSelectionTests -v`

Expected: FAIL — `_invoke_model_json` doesn't check `GENERATION_MODEL_ID` yet.

**Step 4: Implement model selection in `_invoke_model_json`**

In `backend/generation.py`, change line 457 of `_invoke_model_json`:

From:
```python
    model_id = _require_env("BEDROCK_MODEL_ID")
```

To:
```python
    model_id = os.getenv("GENERATION_MODEL_ID", "").strip() or _require_env("BEDROCK_MODEL_ID")
```

**Step 5: Run tests to verify they pass**

Run: `cd /home/jchan/dev/GURT && python -m pytest tests/test_generation.py::GenerationModelSelectionTests -v`

Expected: PASS

**Step 6: Update CDK to wire `GENERATION_MODEL_ID` into Lambda env vars**

In `infra/app.py`, add a new context variable after line 24:

```python
generation_model_id = app.node.try_get_context("generationModelId") or "us.anthropic.claude-haiku-4-5-20251001-v1:0"
```

In `infra/stacks/api_stack.py`, add to the `env` dict (around line 225):

```python
"GENERATION_MODEL_ID": generation_model_id,
```

This requires threading `generation_model_id` through `ApiStack.__init__`. Add a new parameter:

```python
generation_model_id: str,
```

And pass it from `infra/app.py` when constructing `ApiStack`.

Also update `FLASHCARD_MODEL_ID` on line 239 to use the same Haiku model:

From:
```python
"FLASHCARD_MODEL_ID": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
```

To:
```python
"FLASHCARD_MODEL_ID": generation_model_id,
```

And similarly on line 340 for `FlashcardGenWorkerHandler`.

For `PracticeExamGenWorkerHandler` (line 357), add `GENERATION_MODEL_ID` to its environment:

```python
"GENERATION_MODEL_ID": generation_model_id,
```

**Step 7: Run all tests + CDK synth**

Run: `cd /home/jchan/dev/GURT && python -m pytest tests/test_generation.py -v`
Run: `cd /home/jchan/dev/GURT/infra && cdk synth --quiet 2>&1 | head -20`

Expected: All tests pass, synth succeeds.

**Step 8: Commit**

```bash
git add backend/generation.py tests/test_generation.py infra/stacks/api_stack.py infra/app.py
git commit -m "feat: use Haiku 4.5 for flashcard/exam generation, keep Sonnet for chat

Introduces GENERATION_MODEL_ID env var (defaults to Haiku 4.5).
_invoke_model_json prefers GENERATION_MODEL_ID over BEDROCK_MODEL_ID.
Chat continues to use Sonnet 4.5 via BEDROCK_MODEL_ARN.
Saves ~73% on generation inference costs."
```

---

## Task 4: Skip FM-Based KB Document Parsing

**Why:** The KB data source currently uses Claude 3.5 Haiku for multimodal document parsing at $0.80/$4.00 per 1M tokens. The ingest Lambda already extracts text with PyMuPDF/LibreOffice. Using standard parsing instead of FM parsing saves ~$16/month at 200 MAU.

**Files:**
- Modify: `infra/stacks/knowledge_base_stack.py:374-395` (data source parsing config)

**Step 1: Remove the FM parsing configuration from the KB data source**

In `infra/stacks/knowledge_base_stack.py`, the data source at line 361 has a `vector_ingestion_configuration` that includes `parsing_configuration` with `BEDROCK_FOUNDATION_MODEL` strategy (lines 385-395).

Remove the entire `parsing_configuration` block:

```python
            parsing_configuration=bedrock.CfnDataSource.ParsingConfigurationProperty(
                parsing_strategy="BEDROCK_FOUNDATION_MODEL",
                bedrock_foundation_model_configuration=(
                    bedrock.CfnDataSource.BedrockFoundationModelConfigurationProperty(
                        model_arn=parsing_model_arn,
                        parsing_modality="MULTIMODAL",
                    )
                ),
            ),
```

Also remove the `parsing_model_arn` variable and its associated IAM policy (lines 350-359):

```python
        parsing_model_arn = (
            f"arn:aws:bedrock:{self.region}::foundation-model/"
            "anthropic.claude-3-5-haiku-20241022-v1:0"
        )
        kb_service_role.add_to_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel"],
                resources=[parsing_model_arn],
            )
        )
```

The KB will use default text-based parsing (no FM), which is sufficient since PyMuPDF already extracts text before uploading to the KB S3 data source.

**Step 2: Validate with CDK synth**

Run: `cd /home/jchan/dev/GURT/infra && cdk synth --quiet 2>&1 | head -20`

Expected: Successful synthesis.

**Step 3: Commit**

```bash
git add infra/stacks/knowledge_base_stack.py
git commit -m "infra: remove FM-based KB parsing, use standard text parsing

The ingest Lambda already extracts text with PyMuPDF/LibreOffice.
No need to pay Haiku to re-parse the same documents in the KB.
Saves ~$16/month at 200 MAU."
```

---

## Task 5: Remove Bedrock Guardrails from CDK Stack

**Depends on:** Task 2 (backend guardrail removal must be done first)

**Why:** After removing guardrail usage from backend code, the CDK-managed guardrail resource is dead infrastructure that still shows up in the stack.

**Files:**
- Modify: `infra/stacks/api_stack.py:56-207` (guardrail resource creation)
- Modify: `infra/stacks/api_stack.py:225-243` (env vars)
- Modify: `infra/stacks/api_stack.py:327-342` (FlashcardGenWorker env)
- Modify: `infra/stacks/api_stack.py:357-371` (PracticeExamGenWorker env)
- Modify: `infra/stacks/api_stack.py:746-762` (CfnOutputs for guardrail)
- Modify: `infra/app.py:26-27` (guardrail context vars)

**Step 1: Remove the guardrail resource from ApiStack**

In `infra/stacks/api_stack.py`:

Remove the entire guardrail creation block (lines 56-207), which includes:
- `configured_guardrail_id` / `configured_guardrail_version` logic (lines 56-67)
- `CfnGuardrail` resource creation (lines 68-199)
- `CfnGuardrailVersion` resource (lines 200-207)

**Step 2: Remove guardrail parameters from ApiStack.__init__**

Remove these parameters from `__init__` (lines 43-44):
```python
        bedrock_guardrail_id: str,
        bedrock_guardrail_version: str,
```

**Step 3: Remove guardrail env vars from Lambda environments**

In the `env` dict (around line 225), remove:
```python
"BEDROCK_GUARDRAIL_ID": configured_guardrail_id,
"BEDROCK_GUARDRAIL_VERSION": configured_guardrail_version,
```

In `FlashcardGenWorkerHandler` env (around line 338-339), remove:
```python
"BEDROCK_GUARDRAIL_ID": configured_guardrail_id,
"BEDROCK_GUARDRAIL_VERSION": configured_guardrail_version,
```

In `PracticeExamGenWorkerHandler` env (around line 368-369), remove:
```python
"BEDROCK_GUARDRAIL_ID": configured_guardrail_id,
"BEDROCK_GUARDRAIL_VERSION": configured_guardrail_version,
```

**Step 4: Remove guardrail CfnOutputs**

Remove the three guardrail-related outputs (lines ~746-762):
- `BedrockGuardrailId`
- `BedrockGuardrailVersion`
- `BedrockGuardrailMode`

**Step 5: Remove guardrail context vars from app.py**

In `infra/app.py`, remove lines 26-27:
```python
bedrock_guardrail_id = app.node.try_get_context("bedrockGuardrailId") or ""
bedrock_guardrail_version = app.node.try_get_context("bedrockGuardrailVersion") or ""
```

And remove the corresponding kwargs when constructing `ApiStack` (around lines 86-87):
```python
    bedrock_guardrail_id=bedrock_guardrail_id,
    bedrock_guardrail_version=bedrock_guardrail_version,
```

**Step 6: Remove `aws_bedrock` import from api_stack.py if no longer used**

Check if `aws_bedrock` is used elsewhere in `api_stack.py`. It's imported on line 10. After removing guardrails, it's no longer used — remove the import.

**Step 7: Run CDK synth**

Run: `cd /home/jchan/dev/GURT/infra && cdk synth --quiet 2>&1 | head -20`

Expected: Successful synthesis, no guardrail resources in template.

**Step 8: Commit**

```bash
git add infra/stacks/api_stack.py infra/app.py
git commit -m "infra: remove Bedrock Guardrails from CDK stack

Backend regex-based safety (Task 2) replaces Bedrock Guardrails.
Removes CfnGuardrail, CfnGuardrailVersion, and all related
env vars, parameters, and outputs."
```

---

## Task 6: Integration Validation

**Depends on:** Tasks 1-5

**Why:** Verify all changes work together and the full test suite passes.

**Files:**
- No new files — validation only

**Step 1: Run full test suite**

Run: `cd /home/jchan/dev/GURT && python -m pytest tests/ -v`

Expected: All tests pass.

**Step 2: Run CDK synth for all stacks**

Run: `cd /home/jchan/dev/GURT/infra && cdk synth --quiet 2>&1 | tail -20`

Expected: All 4 stacks synthesize successfully (Data, KnowledgeBase, Api, Frontend).

**Step 3: Verify no guardrail references remain in backend**

Run: `cd /home/jchan/dev/GURT && grep -r "GUARDRAIL_ID\|GUARDRAIL_VERSION\|guardrailIdentifier\|guardrailVersion\|_guardrail_settings\|_guardrail_generation_configuration\|_guardrail_intervened\|_raise_if_guardrail_intervened" backend/ infra/ --include="*.py" | grep -v "__pycache__"`

Expected: No matches (all guardrail plumbing removed). The only remaining guardrail references should be in `generation.py` for `GuardrailBlockedError` class and `GUARDRAIL_BLOCKED_MESSAGE` constant (used by regex safety), and the `_enforce_question_safety` function.

**Step 4: Verify OpenSearch references removed from KB stack (if Task 1 succeeded)**

Run: `cd /home/jchan/dev/GURT && grep -r "opensearch\|aoss\|CfnCollection\|CfnSecurityPolicy\|CfnAccessPolicy\|INDEX_CREATOR" infra/stacks/knowledge_base_stack.py`

Expected: No matches.

**Step 5: Verify Haiku model ID is wired correctly**

Run: `cd /home/jchan/dev/GURT && grep -r "GENERATION_MODEL_ID\|haiku" infra/ backend/ --include="*.py" | grep -v "__pycache__"`

Expected: `GENERATION_MODEL_ID` appears in `app.py`, `api_stack.py` (env vars), and `generation.py` (model selection fallback).

**Step 6: Commit (merge branch if using worktrees)**

If all validations pass, the feature branch is ready for merge.

---

## Summary of Expected Cost Impact

| Change | Monthly savings (200 MAU) |
|---|---|
| Task 1: S3 Vectors replaces OpenSearch | -$345.60 |
| Task 2+5: Remove Bedrock Guardrails | -$213.00 |
| Task 3: Haiku for generation | -$54.34 |
| Task 4: Skip FM parsing | -$16.00 |
| **Total** | **-$628.94/month** |
| **New per-user cost** | **~$5.85/user/month** (down from $8.99) |

## Notes for Implementors

1. **Task 1 has the highest risk** — S3 vector store support in Bedrock KB via CloudFormation may not be GA yet. Check AWS docs first. If unavailable, skip Task 1 and file it as a future optimization.

2. **Tasks 2-5 are low risk** — they remove code and configuration, and the test suite validates correctness.

3. **`GuardrailBlockedError` stays** — the regex-based `_enforce_question_safety()` still raises this exception class. Don't remove the class or its constant.

4. **Deployment order matters** — deploy backend code changes (Tasks 2-3) before CDK infrastructure changes (Task 5) to avoid runtime errors from missing env vars. Or deploy atomically if using a single CDK deploy.

5. **Prompt caching and batch inference** are listed in the cost analysis doc (`docs/aws-cost-analysis.md`) as future optimizations. They require Bedrock API changes and are not included in this plan.
