# Dev 3 Plan — Upload + Ingestion + RAG (Flashcards, Practice Exams, Chat)

## Mission

Turn uploaded materials (syllabus, slides, notes; PDFs + plaintext; scanned via Textract) into:

- topics + exam coverage mapping (from syllabus)
- a chunked + embedded knowledge base
- generated flashcards (<=100 for demo) with citations
- generated practice exam questions with citations + explanations + rubrics
- grounded chat with citations

## Ownership

Route prefix: `/uploads`, `/docs/*`, `/generate/*`, `/chat`, `/practice-exam/*`

## Dependencies

- S3 bucket exists for uploads.
- DynamoDB tables exist for Docs/Chunks/Topics/ExamTopicMap/Cards/PracticeExamAttempts.
- Study service (Dev 2) will consume cards you create.

## Deliverables

- Endpoints:
  - `POST /uploads` (presigned URL OR direct upload)
  - `POST /docs/ingest`
  - `POST /generate/flashcards`
  - `POST /generate/practice-exam`
  - `POST /practice-exam/submit` (or `/practice-exam/grade`)
  - `POST /chat`
- Textract fallback for scanned docs
- Citation validator pass (no unsupported answers)

## Step-by-step execution

### 1) Upload to S3

- Support:
  - PDF upload
  - plaintext upload
- Return docId and S3 key.

### 2) Ingest endpoint

- `POST /docs/ingest` takes docId and metadata (courseId, docType: syllabus|slides|notes).
- Extract text:
  - PDF text extraction fast path
  - if text density low -> Textract
- Store `Document` record with extracted text summary.

### 3) Chunking

- Chunk by:
  - headings (if detectable)
  - page boundaries
  - fallback: semantic chunking by length
- Store `Chunks` records with:
  - chunkId, docId, courseId, page, text, docType
- Embed each chunk and store embeddings in your chosen vector store.

### 4) Syllabus parsing -> topics + exam coverage

- Parse syllabus to produce:
  - `Topic` list (topicId/name)
  - `ExamTopicMap` best-effort mapping:
    - exam labels (Midterm/Final) -> topic ranges
- Store to DynamoDB.
- Provide minimal manual override support by allowing client to pass topicIds explicitly during generation.

### 5) Flashcard generation

- `POST /generate/flashcards` inputs:
  - courseId, examId(optional), topicIds, numCards (cap 100 for demo)
- For each topic:
  - retrieve top-k relevant chunks (RAG)
  - generate cards in strict JSON schema:
    - front/back, topicId, citations[{docId,chunkId,snippet,page}]
- Validation pass:
  - ensure answer is supported by cited snippets (regenerate if not)
- Persist to `Cards` table with initial FSRS state (dueAt=now).

### 6) Practice exam generation

- `POST /generate/practice-exam` inputs:
  - courseId, examId, topicIds, numQuestions (cap 10)
- Generate:
  - mix MCQ + short answer
  - include citations + explanations + rubrics
- Validation pass as above.

### 7) Practice exam grading

- `POST /practice-exam/submit` inputs:
  - answers per question + timestamps
- Grade:
  - MCQ deterministic
  - short answer using rubric; require cited reasoning in grader output
- Store attempt to `PracticeExamAttempts` with per-topic breakdown for mastery.

### 8) Chat endpoint

- `POST /chat` inputs:
  - courseId, question, optional topic scope
- Retrieve chunks and answer with citations.
- Refuse to answer if insufficient sources (or return "not found").

## Smoke tests you must pass

- Upload + ingest returns doc and chunk counts (or fixture mode).
- Generate flashcards returns contract-valid cards with citations.
- Generate practice exam returns questions with citations.
- Chat returns cited response.

## Definition of Done

- From scanned notes: ingest -> Textract -> chunks -> generate <=100 cards with citations.
- Practice exam returns 10 questions grounded in sources.
- No generation response without citations.
