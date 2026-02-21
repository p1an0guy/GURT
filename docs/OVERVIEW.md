# StudyBuddy (Hackathon) — Project Overview

## One-line pitch

StudyBuddy is a web app that syncs Canvas deadlines, ingests course materials (syllabus/slides/notes), generates flashcards + practice exams grounded in those sources, schedules reviews using FSRS with exam-aware prioritization, visualizes mastery per topic, and publishes a subscribable ICS calendar feed so assignments/exams/office hours appear in students’ personal calendars.

## Current architecture decisions (locked)

- **Client:** Web app (no desktop app).
- **Backend:** AWS **API Gateway + Lambda** (Lambda proxy integration).
- **IaC scaffold:** AWS CDK (Python) under `infra/` with split stacks:
  - `GurtDataStack` for S3 + DynamoDB.
  - `GurtKnowledgeBaseStack` for Bedrock Knowledge Base + OpenSearch Serverless vector store.
  - `GurtApiStack` for API Gateway + Lambda wiring.
- **Deploy automation:** `./scripts/deploy.sh` runs build + CDK checks + bootstrap + deploy in one command.
- **Storage:**
  - DynamoDB for app state (courses/assignments, cards, reviews, topics, tokens).
  - S3 for uploaded source files.
- **Text extraction:**
  - Fast path: PyMuPDF text extraction
  - Fallback: AWS Textract async OCR when extracted text is insufficient (< 200 chars)
- **AI features:**
  - Model provider: **Amazon Bedrock**.
  - Default model id: `us.anthropic.claude-sonnet-4-6`.
  - Retrieval source: Bedrock Knowledge Base (`KNOWLEDGE_BASE_ID`).
  - RAG index over uploaded sources (chunk + embeddings + retrieval).
  - Generate:
    - Flashcards (<=100 for demo)
    - Practice exam questions (MCQ + short answer, citations)
    - Chat Q&A grounded in sources (citations)
- **Spaced repetition:** Web-hosted **FSRS** (no Anki integration).
- **Schedule truth sources:**
  - **Canvas** is source of truth for _dates/deadlines_.
  - **Syllabus** is source of truth for _topic coverage_ (exam → topics), because coverage is stable even if dates shift.
- **Calendar integration:** Provide a private **ICS subscription feed**. (Google Calendar refresh timing is controlled by Google; not instant.)
- **Authentication for hackathon demo:**
  - No end-user login/auth for now.
  - Canvas token connectivity remains in scope for Canvas data sync.

## Demo scope (strict)

- One demo user.
- One course.
- Inputs: syllabus + slides/notes + scanned notes (Textract).
- Generate up to ~100 flashcards.
- Generate a short practice exam (e.g., 10 questions).
- Show mastery bars per topic updating after study + exam.
- Show ICS feed subscription in Google Calendar (initial import).
- Canvas sync can be real or fixture-based fallback.

## Core user flows

### Flow A — Connect Canvas and view upcoming items

1. User provides Canvas token (demo auth) and Canvas base URL (or configured).
2. Backend fetches courses + upcoming assignments/events.
3. Backend stores Canvas items and exposes them to UI.
4. UI shows timeline + flags an exam date (user can mark an item as an exam if needed).
5. Current scaffold supports `POST /canvas/connect` + `POST /canvas/sync` with:
   - assignments sync (`published=true` and non-null `dueAt`)
   - published/visible course file sync (materials metadata + S3 mirror)
   - per-course partial failure reporting (`failedCourseIds`)
6. EventBridge runs periodic Canvas sync every 24 hours for all users with stored Canvas connections.

### Flow B — Upload materials and build knowledge base

1. User uploads syllabus + slides/notes (PDF, plaintext).
2. Backend stores to S3, extracts text.
3. Chunk, embed, and store chunk metadata + vectors.
4. Ingestion uses `POST /docs/ingest` (start) + `GET /docs/ingest/{jobId}` (poll) backed by Step Functions.
5. When materials are mirrored during Canvas sync and KB IDs are configured, backend starts a Bedrock KB ingestion job automatically.
6. Parse syllabus to produce:
   - Topics (topicId, name)
   - Mapping: examId -> [topicId...]

### Flow C — Generate flashcards and study with FSRS

1. Generate flashcards from materials for selected course/exam/topics.
2. Store cards with topicId and citations.
3. “Today’s Plan” endpoint returns:
   - Due cards (FSRS dueAt <= now)
   - Plus exam-aware boosters (if exam soon or mastery low)
4. Review session:
   - User sees card
   - clicks rating (Again/Hard/Good/Easy equivalent -> 1..4)
   - backend updates FSRS state + logs review
5. UI shows mastery bars per topic updating.

### Flow D — Practice exam mode + diagnostics

1. User requests practice exam for an examId (topic-scoped).
2. RAG generates questions grounded in citations.
3. User answers; backend grades:
   - MCQ auto-grade
   - short answer graded with rubric + cited solution
4. Backend stores attempt, updates topic mastery signals.
5. UI shows topic breakdown and recommended next steps.

### Flow E — Calendar subscription (ICS)

1. Caller requests a feed token via `POST /calendar/token`.
2. Backend mints token, stores token metadata in DynamoDB, and returns feed URL.
   In demo mode, if no authenticated principal is present, it uses `DEMO_USER_ID`.
3. User clicks “Subscribe calendar”.
4. UI shows URL: `/calendar/<token>.ics`.
5. User adds calendar by URL in Google Calendar.
6. Feed includes:
   - assignments + due dates
   - exams
   - office hours (from syllabus parsing and/or manual entry)
   - optional: study blocks (stretch)
7. If Canvas dates change, the backend updates stored Canvas items; ICS reflects updates on next fetch.
8. Demo deploys may enable `CALENDAR_FIXTURE_FALLBACK=1` to return fixture events when the token user has no schedule rows yet.

## API contract (high-level endpoints)

(Exact OpenAPI lives in /contracts/openapi.yaml)

- Canvas:
  - POST `/canvas/connect` (store token for demo user)
  - POST `/canvas/sync` (pull latest items)
  - GET `/courses`
  - GET `/courses/{courseId}/items` (assignments/events/exams)

- Upload + Docs:
  - POST `/uploads` (presigned URL or direct upload)
  - POST `/docs/ingest` (extract, chunk, embed start)
  - GET `/docs/ingest/{jobId}` (workflow status)

- Generation:
  - POST `/generate/flashcards`
  - POST `/generate/practice-exam`
  - POST `/chat`

- Study (FSRS):
  - GET `/study/today?courseId=...&examId=...`
  - POST `/study/review`
  - GET `/study/mastery?courseId=...&examId=...`
  - Note: the repository currently includes an internal pure FSRS module foundation; endpoint responses are still driven by existing fixture/mock flows until study lambdas are wired.

- Calendar:
  - POST `/calendar/token` (mint token for authenticated caller)
  - GET `/calendar/{token}.ics`

## Data model (conceptual)

- User
- Course (Canvas course)
- CanvasItem (assignment/event; includes due date)
- Exam (points to CanvasItem or manual; has date)
- Topic (from syllabus)
- ExamTopicMap (examId -> topicIds)
- Document (uploaded file)
- Chunk (doc chunk with metadata + vector)
- Card (flashcard + citations + topicId)
- CardState (FSRS state; can be embedded in Card row)
- ReviewLog (append-only)
- PracticeExamAttempt (answers, scores, diagnostics)
- CalendarToken (token -> userId mapping)

## Non-goals / out of scope for hackathon

- Google Calendar OAuth write sync (use ICS subscription instead).
- Multi-user production account auth/login.
- Mobile clients.
- Perfect syllabus parsing across all formats (provide manual override for topic mapping).
- Real-time ICS refresh in Google Calendar (cannot force; depends on Google polling).
