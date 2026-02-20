# StudyBuddy (Hackathon) — Project Overview

## One-line pitch

StudyBuddy is a web app that syncs Canvas deadlines, ingests course materials (syllabus/slides/notes), generates flashcards + practice exams grounded in those sources, schedules reviews using FSRS with exam-aware prioritization, visualizes mastery per topic, and publishes a subscribable ICS calendar feed so assignments/exams/office hours appear in students’ personal calendars.

## Current architecture decisions (locked)

- **Client:** Web app (no desktop app).
- **Backend:** AWS **API Gateway + Lambda** (Lambda proxy integration).
- **Infrastructure as Code:** AWS CDK in **Python**.
- **Storage:**
  - DynamoDB for app state (courses/assignments, cards, reviews, topics, tokens).
  - S3 for uploaded source files.
- **Text extraction:**
  - Fast path: PDF text extraction
  - Fallback: AWS Textract for scanned PDFs/images
- **AI features:**
  - Model provider: **Amazon Bedrock**.
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
  - Skip end-user account login/auth for now.
  - Keep Canvas token-based connectivity for pulling Canvas data.

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

### Flow B — Upload materials and build knowledge base

1. User uploads syllabus + slides/notes (PDF, plaintext).
2. Backend stores to S3, extracts text.
3. Chunk, embed, and store chunk metadata + vectors.
4. Parse syllabus to produce:
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

1. User clicks “Subscribe calendar”
2. UI shows URL: `/calendar/<token>.ics`
3. User adds calendar by URL in Google Calendar.
4. Feed includes:
   - assignments + due dates
   - exams
   - office hours (from syllabus parsing and/or manual entry)
   - optional: study blocks (stretch)
5. If Canvas dates change, the backend updates stored Canvas items; ICS reflects updates on next fetch.

## API contract (high-level endpoints)

(Exact OpenAPI lives in /contracts/openapi.yaml)

- Canvas:
  - POST `/canvas/connect` (store token for demo user)
  - POST `/canvas/sync` (pull latest items)
  - GET `/courses`
  - GET `/courses/{courseId}/items` (assignments/events/exams)

- Upload + Docs:
  - POST `/uploads` (presigned URL or direct upload)
  - POST `/docs/ingest` (extract, chunk, embed)
  - GET `/docs` (list)

- Generation:
  - POST `/generate/flashcards`
  - POST `/generate/practice-exam`
  - POST `/chat`

- Study (FSRS):
  - GET `/study/today?courseId=...&examId=...`
  - POST `/study/review`
  - GET `/study/mastery?courseId=...&examId=...`

- Calendar:
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
