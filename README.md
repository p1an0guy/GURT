# GURT - Generative Uni Revision Tool
CPSLO Poly Prompt 2026

# AI-Powered Study buddy

AWS-powered study platform for Canvas-synced revision planning, AI generation, FSRS study loops, and calendar subscription.

## Core Features

- Canvas integration
  - Connect and sync course deadlines/material metadata.
  - Runtime-backed `GET /courses` and `GET /courses/{courseId}/items`.

- Ingestion pipeline for study materials
  - Upload files through `POST /uploads`.
  - Start/poll ingest with `POST /docs/ingest` and `GET /docs/ingest/{jobId}`.
  - Step Functions orchestrates extract + Textract fallback.

- RAG-powered generation on Amazon Bedrock
  - Flashcards: `POST /generate/flashcards`
  - Practice exams: `POST /generate/practice-exam`
  - Chat with citations: `POST /chat`

- FSRS study loop
  - Today queue: `GET /study/today`
  - Review updates: `POST /study/review`
  - Mastery tracking: `GET /study/mastery`

- Calendar subscription
  - Mint token: `POST /calendar/token`
  - Private feed: `GET /calendar/{token}.ics`
  - Works with Google Calendar via ICS URL subscription.


# Disclaimers

**Customers are responsible for making their own independent assessment of the information in this document.**

**This document:**

(a) is for informational purposes only,

(b) represents current AWS product offerings and practices, which are subject to change without notice, and

(c) does not create any commitments or assurances from AWS and its affiliates, suppliers or licensors. AWS products or services are provided “as is” without warranties, representations, or conditions of any kind, whether express or implied. The responsibilities and liabilities of AWS to its customers are controlled by AWS agreements, and this document is not part of, nor does it modify, any agreement between AWS and its customers.

(d) is not to be considered a recommendation or viewpoint of AWS

**Additionally, all prototype code and associated assets should be considered:**

(a) as-is and without warranties

(b) not suitable for production environments

(d) to include shortcuts in order to support rapid prototyping such as, but not limitted to, relaxed authentication and authorization and a lack of strict adherence to security best practices

**All work produced is open source. More information can be found in the GitHub repo.**

## Setup

### Prerequisites

- Node.js `>= 18.18.0` (recommended: Node 20 LTS)
- npm
- Python 3.10+ (backend scripts/tests)
- AWS credentials/profile for deployed API/CDK workflows

### Installation

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
```

## Frontend Local Development

Run from repo root:

```bash
npm run dev
```

Then open `http://localhost:3000`.

Frontend routes:

- `/` is the user-facing dashboard (course overview and course navigation).
- `/flashcards` contains the deck workflow (`Generate Deck`, `Recent Decks`, `Study Deck`).
- `/practice-tests` contains the exam workflow (`Generate Practice Test`, question answering, instant scoring).
- `/dev-tools` is the internal debug console (runtime/API controls).

### Frontend env vars

For just starting the frontend app, no env vars are strictly required.

- `NEXT_PUBLIC_USE_FIXTURES`
  - Optional
  - Default: `true`
  - When `true`, frontend uses local fixture responses.
- `NEXT_PUBLIC_API_BASE_URL`
  - Required only when using live API mode (`NEXT_PUBLIC_USE_FIXTURES=false`)
  - Example: `https://<api-id>.execute-api.<region>.amazonaws.com/dev`

Example (live API mode):

```bash
export NEXT_PUBLIC_API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com/dev"
export NEXT_PUBLIC_USE_FIXTURES="false"
npm run dev
```

### Backend/API validation workflow

```bash
source .venv/bin/activate
python scripts/validate_contracts.py
SMOKE_MOCK_MODE=1 python scripts/run_smoke_tests.py
```

### Common issue

If you see:

`You are using Node.js 18.15.0... Next.js requires ^18.18.0 || ^19.8.0 || >=20.0.0`

upgrade Node first (recommended Node 20), then reinstall dependencies:

```bash
npm install
npm run dev
```

For broader testing and contract/smoke workflows, see `docs/TESTING.md`.



## Architecture

### AWS Services Used

- Amazon CloudFront (frontend delivery)
- Amazon API Gateway
- AWS Lambda
- Amazon DynamoDB
- Amazon S3
- AWS Step Functions
- Amazon EventBridge
- Amazon Textract
- Amazon Bedrock
- Amazon Bedrock Knowledge Base
- Amazon OpenSearch Serverless

### System Components

- Frontend
  - Next.js app deployed behind CloudFront.
  - Calls API via `NEXT_PUBLIC_API_BASE_URL`.

- Backend runtime
  - Lambda handlers serve Canvas, docs, generation, study, and calendar endpoints.
  - API Gateway is the public API surface.

- Data and workflow layer
  - DynamoDB tables for canvas data, cards, docs, and calendar tokens.
  - S3 bucket for uploads and KB source data.
  - Step Functions for document extraction/OCR orchestration.
  - EventBridge rule for periodic Canvas sync.

- AI and retrieval
  - Bedrock model inference for generation/chat.
  - Bedrock Knowledge Base over OpenSearch Serverless vectors with S3 data source.

For full architecture details and diagram, see `/Users/jonahchan/dev/GURT/docs/ARCHITECTURE.md`.


## Support
For queries or issues:
- Jonah Chan, jchan332@calpoly.edu
