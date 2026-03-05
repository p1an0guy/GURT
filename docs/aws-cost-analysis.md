# GURT AWS Cost Analysis & Optimization Guide

> **Date:** March 2026
> **Region:** us-east-1
> **Pricing basis:** Published AWS on-demand rates

---

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture & AWS Services](#architecture--aws-services)
- [AWS Unit Pricing Reference](#aws-unit-pricing-reference)
- [Assumptions](#assumptions)
- [Cost Estimate: 200 MAU (Unoptimized)](#cost-estimate-200-mau-unoptimized)
- [How Scale Affects Per-User Cost](#how-scale-affects-per-user-cost)
- [Optimization Strategies](#optimization-strategies)
  - [Tier 1: High-Impact, Low-Effort](#tier-1-high-impact-low-effort)
  - [Tier 2: Medium-Impact Architectural Changes](#tier-2-medium-impact-architectural-changes)
  - [Tier 3: Longer-Term Strategic Optimizations](#tier-3-longer-term-strategic-optimizations)
- [Optimized Cost Estimate: 200 MAU](#optimized-cost-estimate-200-mau)
- [Optimized Per-User Cost Across Scale](#optimized-per-user-cost-across-scale)
- [Batch vs Provisioned Throughput vs On-Demand](#batch-vs-provisioned-throughput-vs-on-demand)
- [Multi-Tenant Knowledge Base Architecture](#multi-tenant-knowledge-base-architecture)
- [Summary & Recommendations](#summary--recommendations)

---

## Project Overview

GURT (Generative Uni Revision Tool) is an AI-powered study platform that integrates with Canvas LMS. It ingests course materials (PDFs, DOCX, PPTX), builds a RAG knowledge base, and generates flashcards, practice exams, and AI chat with citations — all powered by Amazon Bedrock (Claude Sonnet 4.5). It uses FSRS spaced repetition for optimized study scheduling.

**Core features:**
- Canvas LMS integration (sync deadlines and course materials)
- Document ingestion pipeline (PDF, DOCX, PPTX with OCR fallback)
- RAG-powered AI generation (flashcards, practice exams, chat with citations)
- FSRS spaced repetition study loop
- Private ICS calendar subscription
- Bedrock guardrails for safety (prompt injection, cheating prevention)

---

## Architecture & AWS Services

| Service | Purpose | Configuration |
|---|---|---|
| **API Gateway (REST)** | Public API surface | All routes CORS-enabled, stage name configurable |
| **Lambda** | Compute runtime | 10 functions, 256MB-1.5GB memory, 15s-5min timeouts |
| **DynamoDB** | Data storage | 4 tables, PAY_PER_REQUEST (on-demand) billing |
| **S3** | File uploads & KB data | Single bucket with CORS for frontend uploads |
| **Step Functions** | Workflow orchestration | 3 state machines (ingest, flashcard gen, practice exam gen) |
| **Bedrock** | LLM inference & RAG | Claude Sonnet 4.5, Knowledge Base with OpenSearch Serverless |
| **Bedrock Knowledge Base** | Vector retrieval | Semantic chunking (1000 tokens max), S3 data source, Titan Embed v2 |
| **OpenSearch Serverless** | Vector store | Single collection, VECTORSEARCH type, FAISS engine, 1024 dimensions |
| **Textract** | OCR fallback | Async text detection when extracted text < 200 chars |
| **EventBridge** | Scheduled triggers | Canvas sync rule (24-hour cadence) |
| **CloudFront** | Frontend CDN | S3-backed static hosting for Next.js export |
| **Bedrock Guardrails** | Safety filtering | Topic denial + content filters (CLASSIC tier) |
| **CloudWatch** | Monitoring | Custom metrics from ingest workflow |

### Lambda Functions

| Function | Memory | Timeout | Purpose |
|---|---|---|---|
| AppApiHandler | 512 MB | 29s | Core app endpoints (API Gateway proxy) |
| UploadsHandler | 256 MB | 15s | Presigned S3 URL generation |
| IngestExtractHandler (Docker) | 1536 MB | 120s | PyMuPDF + LibreOffice text extraction |
| IngestStartTextractHandler | 256 MB | 30s | Textract async job initiation |
| IngestPollTextractHandler | 512 MB | 60s | Textract job polling |
| IngestFinalizeHandler | 256 MB | 30s | Persist metadata, trigger KB ingestion |
| FlashcardGenWorkerHandler | 1024 MB | 300s | Bedrock model invocation for flashcards |
| FlashcardGenFinalizeHandler | 256 MB | 30s | Persist cards to DynamoDB |
| PracticeExamGenWorkerHandler | 1024 MB | 300s | Bedrock model invocation for exams |
| PracticeExamGenFinalizeHandler | 256 MB | 30s | Persist exam results to DynamoDB |

### DynamoDB Tables (all on-demand)

| Table | Partition Key | Sort Key | Purpose |
|---|---|---|---|
| CanvasDataTable | `pk` (String) | `sk` (String) | Canvas courses, assignments, connections |
| CalendarTokensTable | `token` (String) | — | Token-to-user mapping for ICS feed |
| DocsTable | `docId` (String) | — | Ingest job metadata, document status |
| CardsTable | `cardId` (String) | — | Flashcard state, FSRS scheduling, topics |

### Step Functions Workflows

1. **DocsIngestStateMachine** (20-min timeout): Extract → [Textract if needed] → Finalize
2. **FlashcardGenStateMachine** (10-min timeout): Worker → Finalize
3. **PracticeExamGenStateMachine** (10-min timeout): Worker → Finalize

### Bedrock Models Used

| Model | Purpose | Pricing tier |
|---|---|---|
| Claude Sonnet 4.5 (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`) | Chat, flashcard gen, practice exam gen | $3.00/$15.00 per 1M input/output tokens |
| Claude 3.5 Haiku (`anthropic.claude-3-5-haiku-20241022-v1:0`) | KB document parsing during ingestion | $0.80/$4.00 per 1M input/output tokens |
| Titan Embed Text v2 (`amazon.titan-embed-text-v2:0`) | Document + query embeddings | $0.20 per 1M tokens |

---

## AWS Unit Pricing Reference

All prices are for us-east-1, on-demand, as of early 2026.

| Service | Unit | Price |
|---|---|---|
| **OpenSearch Serverless** | Per OCU-hour | $0.24 |
| **OpenSearch Serverless** | Minimum OCUs (vector search) | 2 OCUs (always-on) |
| **Bedrock — Claude Sonnet 4.5** | Per 1M input tokens | $3.00 |
| **Bedrock — Claude Sonnet 4.5** | Per 1M output tokens | $15.00 |
| **Bedrock — Claude Haiku 4.5** | Per 1M input tokens | $0.80 |
| **Bedrock — Claude Haiku 4.5** | Per 1M output tokens | $4.00 |
| **Bedrock — Claude 3.5 Haiku** | Per 1M input tokens | $0.80 |
| **Bedrock — Claude 3.5 Haiku** | Per 1M output tokens | $4.00 |
| **Bedrock — Titan Embed v2** | Per 1M tokens | $0.20 |
| **Bedrock Guardrails** | Per 1K text units (topic + content) | ~$1.00 |
| **DynamoDB On-Demand** | Per 1M write request units | $1.25 |
| **DynamoDB On-Demand** | Per 1M read request units | $0.25 |
| **Lambda** | Per 1M requests | $0.20 |
| **Lambda** | Per GB-second | $0.0000166667 |
| **API Gateway REST** | Per 1M requests | $3.50 |
| **API Gateway HTTP** | Per 1M requests | $1.00 |
| **Step Functions Standard** | Per 1K state transitions | $0.025 |
| **S3 Standard** | Per GB/month storage | $0.023 |
| **S3** | Per 1K PUT requests | $0.005 |
| **S3** | Per 1K GET requests | $0.0004 |
| **CloudFront** | Per GB transfer (first 10TB) | $0.085 |
| **CloudFront** | Per 10K HTTP requests | $0.0100 |
| **Textract** | Per 1K pages (async DetectText) | $1.50 |
| **EventBridge** | Per 1M events | $1.00 |
| **CloudWatch Logs** | Per GB ingested | $0.50 |

---

## Assumptions

### Usage Parameters

| Parameter | Value |
|---|---|
| Monthly Active Users (MAU) | 200 |
| Chat messages/user/month | 200 |
| Flashcard gen requests/user/month | 8 |
| Practice exam gen requests/user/month | 5 |
| Courses per user | 3 |
| Docs uploaded/user/month | 5 |
| Avg document size | 3 MB |
| Study review sessions/user/month | 25 (50 cards/session) |
| Avg Bedrock input tokens per request | 2,000 |
| Avg Bedrock output tokens per request | 1,500 |
| % docs needing Textract OCR fallback | 10% |
| Avg pages per OCR document | 10 |
| DAU as % of MAU | 30% |
| Target price point | $15/user/month |

### Monthly Request Volumes (200 MAU)

| Workload | Requests/month |
|---|---|
| Chat messages | 40,000 |
| Flashcard generations | 1,600 |
| Practice exam generations | 1,000 |
| Document ingestions | 1,000 |
| **Total Bedrock inference calls** | **42,600** |

### Additional Assumptions

- Region: us-east-1
- All pricing based on published AWS on-demand rates
- No Savings Plans or Reserved Capacity
- Multi-tenant shared Knowledge Base with metadata filtering for user isolation
- Lambda free tier NOT applied (assumes production account with other workloads)

---

## Cost Estimate: 200 MAU (Unoptimized)

### Bedrock LLM Inference (Claude Sonnet 4.5)

| Workload | Requests | Input tokens | Output tokens | Input $ | Output $ | **Total** |
|---|---|---|---|---|---|---|
| Chat (200/user) | 40,000 | 80M | 60M | $240.00 | $900.00 | **$1,140.00** |
| Flashcard gen | 1,600 | 3.2M | 2.4M | $9.60 | $36.00 | **$45.60** |
| Practice exam gen | 1,000 | 2M | 1.5M | $6.00 | $22.50 | **$28.50** |
| **Subtotal** | **42,600** | **85.2M** | **63.9M** | **$255.60** | **$958.50** | **$1,214.10** |

### Bedrock KB Retrieval

Each chat message + practice exam request triggers a KB Retrieve call. Cost is primarily the underlying vector store compute (OpenSearch OCUs) plus query embedding:

| Component | Queries/mo | Embedding cost (Titan) | **Total** |
|---|---|---|---|
| Chat retrieval | 40,000 | $1.60 | **$1.60** |
| Practice exam retrieval | 1,000 | $0.04 | **$0.04** |

> **Pricing uncertainty:** There may be an additional per-query KB Retrieve fee (~$0.02-0.035/query) depending on pricing tier. If so, add 41,000 x $0.035 = $1,435.00/month to the total. This analysis presents the base case without this fee; see the sensitivity note in the scale section.

### Bedrock KB Ingestion (Haiku parsing + Titan embedding)

1,000 new documents/month:

| Component | Tokens | Cost |
|---|---|---|
| Haiku 3.5 parsing (input) | 10M | $8.00 |
| Haiku 3.5 parsing (output) | 2M | $8.00 |
| Titan embedding | 10M | $2.00 |
| **Subtotal** | | **$18.00** |

### Bedrock Guardrails

Applied to all 42,600 requests, ~5 text units (5,000 chars) average per request:

- 213,000 text units x $1.00/1K = **$213.00/month**

### OpenSearch Serverless

2 OCUs minimum (always-on, 24/7):

- 2 x $0.24/OCU-hr x 720 hrs = **$345.60/month**

### Other Services

| Service | Calculation | Monthly Cost |
|---|---|---|
| Lambda | ~60K invocations, ~30K GB-sec | $0.50 |
| API Gateway REST | ~100K requests | $0.35 |
| DynamoDB | ~500K WRU, ~1.2M RRU | $0.93 |
| S3 | ~3 GB storage + requests | $0.10 |
| Step Functions | ~20K transitions | $0.50 |
| CloudFront | ~1 GB transfer | $0.20 |
| Textract | ~1,000 pages | $1.50 |
| EventBridge + CloudWatch | | $2.00 |
| **Subtotal** | | **$6.08** |

### Total: 200 MAU (Unoptimized)

| Component | Monthly Cost | % of Total |
|---|---|---|
| Bedrock Sonnet 4.5 inference | $1,214.10 | 63% |
| OpenSearch Serverless | $345.60 | 18% |
| Bedrock Guardrails | $213.00 | 11% |
| Bedrock KB ingestion (Haiku + Titan) | $18.00 | 1% |
| Bedrock KB query embedding (Titan) | $1.64 | <1% |
| All other services | $6.08 | <1% |
| **TOTAL** | **$1,798.42/month** | |
| **Per-user cost** | **$8.99/user/month** | |

---

## How Scale Affects Per-User Cost

OpenSearch Serverless is a **fixed floor cost** regardless of users. Bedrock inference scales linearly. Per-user cost therefore follows:

```
per_user_cost = (fixed_costs / num_users) + variable_cost_per_user
```

### Unoptimized Per-User Cost by Scale

| MAU | Fixed (OpenSearch) | Variable | Total/month | **Per-user** |
|---|---|---|---|---|
| 50 | $345.60 | $363.21 | $708.81 | **$14.18** |
| 100 | $345.60 | $726.41 | $1,072.01 | **$10.72** |
| 200 | $345.60 | $1,452.82 | $1,798.42 | **$8.99** |
| 500 | $345.60 | $3,632.06 | $3,977.66 | **$7.96** |
| 1,000 | $518.40 | $7,264.11 | $7,782.51 | **$7.78** |
| 5,000 | $1,036.80 | $36,320.56 | $37,357.36 | **$7.47** |

> OCUs scale up at higher loads (~3 OCUs at 1K MAU, ~6 at 5K MAU).

**Key insight:** The curve flattens fast. Past ~200 users, you're mostly paying the per-request Bedrock rate (~$7.26/user). Below 200 users, the OpenSearch fixed cost inflates per-user pricing significantly.

### Sensitivity: With KB Retrieve per-query fee

If the $0.035/query fee applies, add $7.18/user/month across all tiers. This would push unoptimized per-user cost to ~$16.17 at 200 MAU — above the $15 target. This makes the caching optimization (see below) critical.

---

## Optimization Strategies

### Tier 1: High-Impact, Low-Effort

#### 1. Replace OpenSearch Serverless with S3 Vectors

**Savings: $345.60/month at minimum (eliminates the fixed floor cost)**

AWS S3 Tables with vector index support (announced re:Invent 2024, now GA) provides vector storage and search directly in S3. No minimum compute cost, pure pay-per-query + storage:

- Storage: ~$0.023/GB/month (standard S3 rates)
- Queries: priced per query, much cheaper than OCU-hours
- At 200 MAU with ~3 GB of vector data and ~41K queries: **~$2-5/month** vs $345.60

**Implementation:** Update `KnowledgeBaseStack` to use `S3` storage type instead of `OPENSEARCH_SERVERLESS` in the KB `storage_configuration`.

#### 2. Drop Bedrock Guardrails, use prompt-based safety

**Savings: $213/month at 200 MAU, $2,500/month at 10K MAU**

Replace the per-request Guardrails cost with:

- Robust system prompt instructions with safety guidelines (free — part of the model call)
- A simple keyword blocklist filter in Lambda (~5 lines of code, $0 cost)
- The existing word policy (blocking "answer key", "do my homework", "take my exam") can be replicated with a regex check

Guardrails are useful but at 11% of the bill for a student product, the ROI is poor. The system prompt approach provides comparable protection for structured education use cases.

#### 3. Use Haiku 4.5 for flashcard/exam generation, keep Sonnet for chat

**Savings: $54.34/month at 200 MAU, ~$8,500/month at 10K MAU**

Flashcard and practice exam generation produce structured JSON output where Haiku excels. Chat quality benefits from Sonnet's stronger reasoning. Split the model usage:

| Workload | Current Model | Recommended Model | Cost Change |
|---|---|---|---|
| Chat | Sonnet 4.5 | Sonnet 4.5 (keep) | — |
| Flashcard gen | Sonnet 4.5 | **Haiku 4.5** | -73% |
| Practice exam gen | Sonnet 4.5 | **Haiku 4.5** | -73% |

**Implementation:** Change the `FLASHCARD_MODEL_ID` and add a `PRACTICE_EXAM_MODEL_ID` environment variable pointing to Haiku 4.5.

#### 4. Skip Haiku parsing in KB ingestion, use pre-extracted text

**Savings: $16/month at 200 MAU, $800/month at 10K MAU**

The ingest Lambda already extracts text with PyMuPDF and LibreOffice. There's no need to pay Haiku to re-parse the same documents. Feed pre-extracted text directly to the KB:

- Set KB `parsing_strategy` to standard (no foundation model)
- Upload pre-extracted text to the KB S3 prefix instead of the original files

**Implementation:** In `KnowledgeBaseStack`, remove the `bedrock_foundation_model_configuration` from `parsing_configuration`, or change `parsing_strategy` to a non-FM option.

### Tier 2: Medium-Impact Architectural Changes

#### 5. Enable Bedrock Prompt Caching for chat

**Savings: ~$130/month at 200 MAU**

Chat requests to the same course reuse a large system prompt + KB context. With Bedrock prompt caching:

- Cached input tokens cost 90% less
- ~60% of input tokens are cacheable (system prompt + common course context)
- Chat input cost reduction: $240 x 0.6 x 0.9 = **$129.60 saved/month**

**Implementation:** Enable prompt caching on the Bedrock InvokeModel calls in the chat handler. Requires structuring the prompt with cacheable prefix.

#### 6. Use Batch Inference for flashcard/exam generation

**Savings: 50% on gen workflow Bedrock costs**

Step Functions workflows are already async — users poll for results. Bedrock batch inference offers a 50% discount on model invocation:

- Flashcard gen: $12.16 -> $6.08 (with Haiku)
- Practice exam gen: $7.60 -> $3.80 (with Haiku)
- Latency: results come in minutes instead of seconds (acceptable for generation workflows)
- **Not applicable to chat** (requires real-time response)

**Implementation:** Replace `bedrock:InvokeModel` calls in worker Lambdas with batch job submission. Add polling logic to Step Functions to check batch job completion.

#### 7. Cache KB retrieval results

**Savings: significant if per-query KB fee applies (~$1,076/month at 200 MAU)**

Many students in the same course query similar materials. Implement a DynamoDB TTL cache:

- Cache key: `(courseId, query_embedding_hash)`
- Expected cache hit rate for same-course queries: 60-80%
- At 75% hit rate: 41K queries -> 10.25K actual KB calls
- DynamoDB cache storage cost: negligible (~$1/month)

This is especially important if the $0.035/query KB Retrieve fee applies.

#### 8. Switch to HTTP API Gateway (from REST API)

**Savings: ~70% on API Gateway costs ($0.25/month at 200 MAU)**

HTTP APIs cost $1.00/million requests vs $3.50/million for REST APIs. GURT doesn't use REST-specific features. Minimal savings at low scale, but adds up:

- 200 MAU: saves $0.25/month
- 10K MAU: saves $15/month

### Tier 3: Longer-Term Strategic Optimizations

#### 9. Implement user-level usage quotas

Cap free-tier users at X generations/month and X chat messages/month. This:
- Bounds worst-case costs
- Creates a natural freemium upgrade path
- Suggested free tier: 50 chat messages, 3 flashcard gens, 2 practice exams/month
- Paid tier ($15/month): 200+ chat, 8 flashcard, 5 practice exam gens

#### 10. Multi-tenant shared Knowledge Bases per course

Instead of per-user document ingestion, detect when multiple students upload the same course materials (by file hash) and share KB data:
- Deduplication at the S3 key level reduces ingestion costs linearly
- Common textbooks and lecture slides only need to be embedded once
- User-specific notes remain isolated via metadata tags

#### 11. Use open-source embedding models via SageMaker

Replace Titan Embed v2 ($0.20/1M tokens) with a self-hosted model on a small SageMaker endpoint. At 200 MAU embedding costs are only ~$2/month, so this is very low priority unless you reach 10K+ MAU ($100/month).

---

## Optimized Cost Estimate: 200 MAU

Applying optimizations 1-6 (S3 Vectors, drop Guardrails, Haiku for gen, skip FM parsing, prompt caching, batch inference):

| Component | Before | After | Change |
|---|---|---|---|
| Bedrock Sonnet (chat) | $1,140.00 | **$1,010.40** | Prompt caching (-$129.60) |
| Bedrock Sonnet (gen) | $74.10 | — | Moved to Haiku |
| Bedrock Haiku (gen, batch) | — | **$9.88** | Haiku + 50% batch discount |
| OpenSearch Serverless | $345.60 | **$3.00** | S3 Vectors |
| Bedrock Guardrails | $213.00 | **$0.00** | Prompt-based safety |
| KB ingestion (Haiku parsing) | $18.00 | **$2.00** | Pre-extracted text (Titan only) |
| KB query embedding (Titan) | $1.64 | **$1.64** | No change |
| All other services | $6.08 | **$6.08** | No change |
| | | | |
| **TOTAL** | **$1,798.42** | **$1,033.00** | **-43%** |
| **Per-user** | **$8.99** | **$5.17** | |
| **Margin to $15 target** | $6.01 | **$9.83** | |

---

## Optimized Per-User Cost Across Scale

| MAU | Unoptimized/user | Optimized/user | Margin to $15 |
|---|---|---|---|
| 50 | $14.18 | **$5.50** | $9.50 |
| 100 | $10.72 | **$5.20** | $9.80 |
| 200 | $8.99 | **$5.17** | $9.83 |
| 500 | $7.96 | **$5.15** | $9.85 |
| 1,000 | $7.78 | **$5.14** | $9.86 |
| 5,000 | $7.47 | **$5.13** | $9.87 |

The optimized cost is dominated by Bedrock Sonnet chat inference (~$5.13/user), which is essentially constant per user regardless of scale.

---

## Batch vs Provisioned Throughput vs On-Demand

| Option | How it works | Discount | Best for |
|---|---|---|---|
| **On-demand** (current) | Pay per token, no commitment | Baseline | Unpredictable/low traffic, real-time chat |
| **Batch inference** | Submit jobs, results in minutes/hours | **50% off** | Async generation workflows (flashcards, exams) |
| **Provisioned throughput** | Reserve guaranteed model capacity (model units) | 20-40% off | High steady-state traffic (1K+ MAU with constant load) |

**Recommendation at 200 MAU:**
- **On-demand** for chat (needs real-time response)
- **Batch** for flashcard and practice exam generation (already async via Step Functions)
- **Skip provisioned throughput** until 1K+ MAU with sustained traffic patterns

---

## Multi-Tenant Knowledge Base Architecture

### The Problem

Per-user Knowledge Bases would require separate OpenSearch Serverless collections:
- 200 users x 2 OCUs x $0.24/hr x 720 hrs = **$69,120/month** (not viable)

### The Solution: Shared KB + Metadata Filtering

Use a single Knowledge Base with metadata-based user isolation:

1. **Tag documents at ingestion** with `userId` and `courseId` metadata
2. **Filter at query time** using Bedrock KB's metadata filter parameter:
   ```json
   {
     "filter": {
       "andAll": [
         {"equals": {"key": "userId", "value": "user-123"}},
         {"equals": {"key": "courseId", "value": "course-psych-101"}}
       ]
     }
   }
   ```
3. **Result:** Each user only retrieves their own course materials, identical to having separate KBs

**Cost:** One shared collection = $345.60/month (or ~$3/month with S3 Vectors) regardless of user count.

This is the standard multi-tenant pattern for Bedrock Knowledge Bases and provides complete data isolation at a fraction of the cost.

---

## Summary & Recommendations

### Cost Profile

| Scenario | Monthly Total | Per-User | Fits $15 Target? |
|---|---|---|---|
| 200 MAU, unoptimized | $1,798 | $8.99 | Yes |
| 200 MAU, optimized | $1,033 | $5.17 | Yes (with $9.83 margin) |
| 50 MAU, optimized | $275 | $5.50 | Yes (with $9.50 margin) |

### Priority Actions (ordered by impact)

1. **Replace OpenSearch Serverless with S3 Vectors** — eliminates $345.60/month fixed cost; critical at low user counts
2. **Drop Bedrock Guardrails** — saves 11% of total cost; replace with prompt-based safety
3. **Use Haiku for structured generation** — 73% cheaper for flashcard/exam workflows
4. **Enable prompt caching for chat** — 10-15% savings on the largest cost component
5. **Use batch inference for generation** — 50% discount on async workflows
6. **Skip FM-based KB parsing** — leverage existing PyMuPDF extraction

### Key Takeaways

- **Bedrock Sonnet chat inference is 63% of cost** and scales linearly with users — this is the irreducible floor
- **Scale doesn't matter much past ~200 users** for per-user cost since fixed costs (OpenSearch) become negligible
- **Below 200 users, eliminating OpenSearch is the single most impactful change**
- **At $15/user/month target, you have ~$10/user margin** (optimized) to cover auth infrastructure (Cognito), monitoring, operational overhead, and profit
- **The optimized architecture supports a viable freemium model** with a free tier (~50 chat messages/month) and $15/month paid tier
