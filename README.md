# GURT - Generative Uni Revision Tool
CPSLO Poly Prompt 2026

# AI-Powered Study buddy

AWS-powered...

## Core Features



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
- Python 3.10+ (for backend/test scripts)

### Installation

```bash
npm install
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


### System Components




## Support
For queries or issues:
- Jonah Chan, jchan332@calpoly.edu
