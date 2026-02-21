"use client";

import { useMemo, useState } from "react";
import DashboardPage from "./dashboard.tsx";

import { createApiClient } from "../src/api/client.ts";
import type {
  CanvasItem,
  CanvasSyncResponse,
  Card,
  ChatResponse,
  Course,
  PracticeExam,
  TopicMastery,
} from "../src/api/types.ts";

const DEFAULT_COURSE_ID = "course-psych-101";
const DEFAULT_CALENDAR_TOKEN =
  process.env.NEXT_PUBLIC_CALENDAR_TOKEN ?? "demo-calendar-token";

function toNowRfc3339(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kbIngestionStatusMessage(sync: CanvasSyncResponse): string {
  if (sync.materialsMirrored === 0) {
    return "No new mirrored materials.";
  }
  if (sync.knowledgeBaseIngestionStarted) {
    if (sync.knowledgeBaseIngestionJobId) {
      return `KB ingestion started (jobId: ${sync.knowledgeBaseIngestionJobId}).`;
    }
    return "KB ingestion started.";
  }
  if (sync.knowledgeBaseIngestionError) {
    return `KB ingestion not started: ${sync.knowledgeBaseIngestionError}.`;
  }
  return "KB ingestion not started.";
}

export function DevConsolePage() {
  const [baseUrl, setBaseUrl] = useState(
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
  );
  const [useFixtures, setUseFixtures] = useState(
    (process.env.NEXT_PUBLIC_USE_FIXTURES ?? "true").toLowerCase() !== "false",
  );
  const [courseId, setCourseId] = useState(DEFAULT_COURSE_ID);
  const [calendarToken, setCalendarToken] = useState(DEFAULT_CALENDAR_TOKEN);
  const [canvasBaseUrl, setCanvasBaseUrl] = useState("https://canvas.calpoly.edu/");
  const [canvasAccessToken, setCanvasAccessToken] = useState("");
  const [lastCanvasSync, setLastCanvasSync] = useState<CanvasSyncResponse | null>(null);
  const [canvasSyncLoading, setCanvasSyncLoading] = useState(false);
  const [canvasSyncError, setCanvasSyncError] = useState("");
  const [canvasSyncWarning, setCanvasSyncWarning] = useState("");
  const [numCards, setNumCards] = useState("10");
  const [numQuestions, setNumQuestions] = useState("10");
  const [generatedCards, setGeneratedCards] = useState<Card[]>([]);
  const [generateCardsLoading, setGenerateCardsLoading] = useState(false);
  const [generateCardsError, setGenerateCardsError] = useState("");
  const [lastCardsGeneratedAt, setLastCardsGeneratedAt] = useState("");
  const [practiceExam, setPracticeExam] = useState<PracticeExam | null>(null);
  const [generateExamLoading, setGenerateExamLoading] = useState(false);
  const [generateExamError, setGenerateExamError] = useState("");
  const [lastExamGeneratedAt, setLastExamGeneratedAt] = useState("");
  const [chatQuestion, setChatQuestion] = useState("What are the most important topics this week?");
  const [chatResponse, setChatResponse] = useState<ChatResponse | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [lastChatAt, setLastChatAt] = useState("");
  const [health, setHealth] = useState<string>("unknown");
  const [courses, setCourses] = useState<Course[]>([]);
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [mastery, setMastery] = useState<TopicMastery[]>([]);
  const [calendarUrl, setCalendarUrl] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [ingestDocId, setIngestDocId] = useState("doc-demo-001");
  const [ingestKey, setIngestKey] = useState("uploads/course-psych-101/doc-demo-001/syllabus.pdf");
  const [ingestJobId, setIngestJobId] = useState("");
  const [ingestStatus, setIngestStatus] = useState("");
  const [lastIngestUpdatedAt, setLastIngestUpdatedAt] = useState("");
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestError, setIngestError] = useState("");

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl,
        useFixtures,
      }),
    [baseUrl, useFixtures],
  );

  async function handleLoadOverview(): Promise<void> {
    setMessage("");
    try {
      const [healthResp, coursesResp, itemsResp, masteryResp] = await Promise.all([
        client.getHealth(),
        client.listCourses(),
        client.listCourseItems(courseId),
        client.getStudyMastery(courseId),
      ]);

      setHealth(healthResp.status);
      setCourses(coursesResp);
      setItems(itemsResp);
      setMastery(masteryResp);
      setCalendarUrl(
        `${baseUrl.replace(/\/$/, "") || ""}/calendar/${encodeURIComponent(
          calendarToken,
        )}.ics`,
      );
      setMessage(`Loaded course data for ${courseId}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function handleSubmitReview(): Promise<void> {
    setMessage("");
    try {
      await client.postStudyReview({
        cardId: "card-001",
        courseId,
        rating: 4,
        reviewedAt: toNowRfc3339(),
      });
      setMessage("Review event accepted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function handleMintCalendarToken(): Promise<void> {
    setMessage("");
    try {
      const minted = await client.createCalendarToken();
      setCalendarToken(minted.token);
      setCalendarUrl(minted.feedUrl);
      setMessage(`Minted calendar token at ${minted.createdAt}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function handleCanvasConnect(): Promise<void> {
    setMessage("");
    try {
      const response = await client.connectCanvas({
        canvasBaseUrl,
        accessToken: canvasAccessToken,
      });
      setMessage(`Canvas connected at ${response.updatedAt}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function handleCanvasSync(): Promise<void> {
    setMessage("");
    setCanvasSyncError("");
    setCanvasSyncWarning("");
    setCanvasSyncLoading(true);
    try {
      const sync = await client.syncCanvas();
      setLastCanvasSync(sync);
      if (sync.failedCourseIds.length > 0) {
        setCanvasSyncWarning(`Partial sync. Failed course IDs: ${sync.failedCourseIds.join(", ")}`);
      }
      const failed = sync.failedCourseIds.length > 0 ? ` (failed: ${sync.failedCourseIds.join(", ")})` : "";
      const kbStatus = kbIngestionStatusMessage(sync);
      setMessage(
        `Canvas sync: ${sync.coursesUpserted} course(s), ${sync.itemsUpserted} item(s), ${sync.materialsMirrored} material(s) mirrored${failed}. ${kbStatus}`,
      );
      const [coursesResp, itemsResp, masteryResp] = await Promise.all([
        client.listCourses(),
        client.listCourseItems(courseId),
        client.getStudyMastery(courseId),
      ]);
      setCourses(coursesResp);
      setItems(itemsResp);
      setMastery(masteryResp);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setCanvasSyncError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setCanvasSyncLoading(false);
    }
  }

  async function handleGenerateFlashcards(): Promise<void> {
    setMessage("");
    setGenerateCardsLoading(true);
    setGenerateCardsError("");
    try {
      const requested = Number.parseInt(numCards, 10);
      const cards = await client.generateFlashcards(courseId, Number.isNaN(requested) ? 10 : requested);
      setGeneratedCards(cards);
      setLastCardsGeneratedAt(toNowRfc3339());
      setMessage(`Generated ${cards.length} flashcard(s).`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setGenerateCardsError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setGenerateCardsLoading(false);
    }
  }

  async function handleGeneratePracticeExam(): Promise<void> {
    setMessage("");
    setGenerateExamLoading(true);
    setGenerateExamError("");
    try {
      const requested = Number.parseInt(numQuestions, 10);
      const exam = await client.generatePracticeExam(courseId, Number.isNaN(requested) ? 10 : requested);
      setPracticeExam(exam);
      setLastExamGeneratedAt(exam.generatedAt);
      setMessage(`Generated practice exam with ${exam.questions.length} question(s).`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setGenerateExamError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setGenerateExamLoading(false);
    }
  }

  async function handleChatAsk(): Promise<void> {
    setMessage("");
    setChatLoading(true);
    setChatError("");
    try {
      const response = await client.chat(courseId, chatQuestion);
      setChatResponse(response);
      setLastChatAt(toNowRfc3339());
      setMessage("Chat response loaded.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setChatError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleStartIngest(): Promise<void> {
    setMessage("");
    setIngestError("");
    setIngestStatus("");
    setLastIngestUpdatedAt("");
    setIngestLoading(true);
    try {
      const docId = ingestDocId.trim();
      const key = ingestKey.trim();
      if (!docId) {
        throw new Error("Ingest docId is required.");
      }
      if (!key) {
        throw new Error("Ingest key is required.");
      }

      const start = await client.startDocsIngest({
        docId,
        courseId,
        key,
      });
      setIngestJobId(start.jobId);
      setIngestStatus(start.status);
      setLastIngestUpdatedAt(start.updatedAt);
      setMessage(`Ingest started (jobId: ${start.jobId}).`);

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const status = await client.getDocsIngestStatus(start.jobId);
        setIngestStatus(status.status);
        setLastIngestUpdatedAt(status.updatedAt);
        if (status.status === "FINISHED") {
          setMessage(
            `Ingest finished (jobId: ${status.jobId}, textLength: ${status.textLength}, textract: ${status.usedTextract ? "yes" : "no"}).`,
          );
          return;
        }
        if (status.status === "FAILED") {
          throw new Error(`Ingest failed (jobId: ${status.jobId}): ${status.error || "unknown error"}`);
        }
        await waitMs(1500);
      }
      throw new Error(`Ingest polling timed out for job ${start.jobId}.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setIngestError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setIngestLoading(false);
    }
  }

  return (
    <>
      {ingestLoading ? (
        <div className="loading-screen" role="status" aria-live="polite">
          <div className="loading-card">
            <h2>Processing Document</h2>
            <p>
              {ingestJobId
                ? `Polling ingest job ${ingestJobId} (${ingestStatus || "RUNNING"})...`
                : "Starting ingest workflow..."}
            </p>
          </div>
        </div>
      ) : null}
      <main className="page">
        <section className="hero">
          <h1>StudyBuddy Demo Console</h1>
          <p>
            Browser shell for validating API routes, fixture mode, and calendar feed wiring.
            Use this while CDK-backed infrastructure is being deployed.
          </p>
        </section>

        <section className="panel-grid">
          <article className="panel">
          <h2>Connection</h2>
          <div className="controls">
            <label htmlFor="baseUrl">API Base URL</label>
            <input
              id="baseUrl"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://<api-id>.execute-api.<region>.amazonaws.com/dev"
            />

            <label htmlFor="courseId">Course ID</label>
            <input
              id="courseId"
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
            />

            <label htmlFor="calendarToken">Calendar Token</label>
            <input
              id="calendarToken"
              value={calendarToken}
              onChange={(event) => setCalendarToken(event.target.value)}
            />

            <label htmlFor="fixtures">Mode</label>
            <select
              id="fixtures"
              value={useFixtures ? "fixtures" : "live"}
              onChange={(event) => setUseFixtures(event.target.value === "fixtures")}
            >
              <option value="fixtures">Fixtures (recommended while infra boots)</option>
              <option value="live">Live API</option>
            </select>

            <button type="button" onClick={handleLoadOverview}>
              Load Data
            </button>
            <label htmlFor="canvasBaseUrl">Canvas Base URL</label>
            <input
              id="canvasBaseUrl"
              value={canvasBaseUrl}
              onChange={(event) => setCanvasBaseUrl(event.target.value)}
              placeholder="https://canvas.calpoly.edu/"
            />
            <label htmlFor="canvasAccessToken">Canvas Access Token</label>
            <input
              id="canvasAccessToken"
              value={canvasAccessToken}
              onChange={(event) => setCanvasAccessToken(event.target.value)}
              placeholder="paste token for live sync"
              type="password"
            />
            <button type="button" onClick={handleCanvasConnect}>
              Connect Canvas
            </button>
            <button type="button" onClick={handleCanvasSync} disabled={canvasSyncLoading}>
              {canvasSyncLoading ? "Syncing..." : "Sync Canvas"}
            </button>
            {canvasSyncWarning ? <p className="warning-text">{canvasSyncWarning}</p> : null}
            {canvasSyncError ? (
              <>
                <p className="error-text">Canvas sync failed: {canvasSyncError}</p>
                <button type="button" className="secondary-button" onClick={handleCanvasSync} disabled={canvasSyncLoading}>
                  Retry Canvas Sync
                </button>
              </>
            ) : null}
            <button type="button" onClick={handleSubmitReview}>
              Send Review Event
            </button>
            <button type="button" onClick={handleMintCalendarToken}>
              Mint Calendar Token
            </button>

            <label htmlFor="ingestDocId">Ingest Doc ID</label>
            <input
              id="ingestDocId"
              value={ingestDocId}
              onChange={(event) => setIngestDocId(event.target.value)}
              placeholder="doc-demo-001"
            />
            <label htmlFor="ingestKey">Ingest S3 Key</label>
            <input
              id="ingestKey"
              value={ingestKey}
              onChange={(event) => setIngestKey(event.target.value)}
              placeholder="uploads/course-psych-101/doc-demo-001/syllabus.pdf"
            />
            <button type="button" onClick={handleStartIngest} disabled={ingestLoading}>
              {ingestLoading ? "Ingesting..." : "Start Ingest"}
            </button>
            {ingestError ? (
              <>
                <p className="error-text">Ingest failed: {ingestError}</p>
                <button type="button" className="secondary-button" onClick={handleStartIngest} disabled={ingestLoading}>
                  Retry Ingest
                </button>
              </>
            ) : null}

            <label htmlFor="numCards">Generate Flashcards</label>
            <input
              id="numCards"
              value={numCards}
              onChange={(event) => setNumCards(event.target.value)}
              placeholder="10"
            />
            <button type="button" onClick={handleGenerateFlashcards} disabled={generateCardsLoading}>
              {generateCardsLoading ? "Generating..." : "Generate Cards"}
            </button>
            {generateCardsError ? (
              <>
                <p className="error-text">Flashcard generation failed: {generateCardsError}</p>
                <button type="button" className="secondary-button" onClick={handleGenerateFlashcards} disabled={generateCardsLoading}>
                  Retry Generate Cards
                </button>
              </>
            ) : null}

            <label htmlFor="numQuestions">Generate Practice Exam</label>
            <input
              id="numQuestions"
              value={numQuestions}
              onChange={(event) => setNumQuestions(event.target.value)}
              placeholder="10"
            />
            <button type="button" onClick={handleGeneratePracticeExam} disabled={generateExamLoading}>
              {generateExamLoading ? "Generating..." : "Generate Exam"}
            </button>
            {generateExamError ? (
              <>
                <p className="error-text">Practice exam generation failed: {generateExamError}</p>
                <button type="button" className="secondary-button" onClick={handleGeneratePracticeExam} disabled={generateExamLoading}>
                  Retry Generate Exam
                </button>
              </>
            ) : null}

            <label htmlFor="chatQuestion">Chat Question</label>
            <input
              id="chatQuestion"
              value={chatQuestion}
              onChange={(event) => setChatQuestion(event.target.value)}
              placeholder="Ask a course question"
            />
            <button type="button" onClick={handleChatAsk} disabled={chatLoading}>
              {chatLoading ? "Asking..." : "Ask Chat"}
            </button>
            {chatError ? (
              <>
                <p className="error-text">Chat failed: {chatError}</p>
                <button type="button" className="secondary-button" onClick={handleChatAsk} disabled={chatLoading}>
                  Retry Chat
                </button>
              </>
            ) : null}
          </div>
          </article>

          <article className="panel">
          <h2>Status</h2>
          <div className="stack">
            <p className={`status ${health === "ok" ? "ok" : "warn"}`}>
              Health: {health}
            </p>
            <p className="small">{message || "No requests yet."}</p>
            <div className="status-block">
              <p className="small"><strong>Canvas Sync</strong></p>
              <p className="small">
                {lastCanvasSync
                  ? `Last success: ${lastCanvasSync.updatedAt} (${lastCanvasSync.itemsUpserted} items, ${lastCanvasSync.materialsMirrored} mirrored)`
                  : "No successful sync yet."}
              </p>
              {canvasSyncWarning ? <p className="warning-text">{canvasSyncWarning}</p> : null}
              {canvasSyncError ? <p className="error-text">{canvasSyncError}</p> : null}
            </div>
            <div className="status-block">
              <p className="small"><strong>Knowledge Base Ingestion</strong></p>
              <p className="small">
                {lastCanvasSync
                  ? `Last sync ${lastCanvasSync.updatedAt}: ${kbIngestionStatusMessage(lastCanvasSync)}`
                  : "No successful canvas sync yet."}
              </p>
            </div>
            <div className="status-block">
              <p className="small"><strong>Docs Ingest</strong></p>
              <p className="small">
                {ingestJobId
                  ? `Job ${ingestJobId}: ${ingestStatus || "RUNNING"} (${lastIngestUpdatedAt || "pending"})`
                  : "No ingest job started yet."}
              </p>
              {ingestError ? <p className="error-text">{ingestError}</p> : null}
            </div>
            <div className="status-block">
              <p className="small"><strong>Generation + Chat</strong></p>
              <p className="small">
                Flashcards: {lastCardsGeneratedAt || "none"} | Exam: {lastExamGeneratedAt || "none"} | Chat: {lastChatAt || "none"}
              </p>
              {generateCardsError ? <p className="error-text">Cards: {generateCardsError}</p> : null}
              {generateExamError ? <p className="error-text">Exam: {generateExamError}</p> : null}
              {chatError ? <p className="error-text">Chat: {chatError}</p> : null}
            </div>
            <p className="small">Calendar feed URL:</p>
            <p className="mono">{calendarUrl || "(load data to generate URL)"}</p>
          </div>
          </article>

          <article className="panel">
          <h2>Courses</h2>
          <ul className="list">
            {courses.map((course) => (
              <li key={course.id}>
                <strong>{course.name}</strong>
                <span className="tag">{course.term}</span>
                <div className="small mono">{course.id}</div>
              </li>
            ))}
          </ul>
          </article>

          <article className="panel">
          <h2>Upcoming Items</h2>
          <ul className="list">
            {items.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <span className="tag">{item.itemType}</span>
                <div className="small">{item.dueAt}</div>
              </li>
            ))}
          </ul>
          </article>

          <article className="panel">
          <h2>Topic Mastery</h2>
          <ul className="list">
            {mastery.map((topic) => (
              <li key={topic.topicId}>
                <strong>{topic.topicId}</strong>
                <div className="small">
                  Mastery {(topic.masteryLevel * 100).toFixed(0)}% • Due cards {topic.dueCards}
                </div>
              </li>
            ))}
          </ul>
          </article>

          <article className="panel">
          <h2>Generated Flashcards</h2>
          <ul className="list">
            {generatedCards.map((card) => (
              <li key={card.id}>
                <strong>{card.prompt}</strong>
                <div className="small">{card.answer}</div>
                <div className="small mono">{card.topicId}</div>
              </li>
            ))}
          </ul>
          </article>

          <article className="panel">
          <h2>Practice Exam + Chat</h2>
          <div className="stack">
            {practiceExam ? (
              <p className="small">
                Practice exam generated at {practiceExam.generatedAt} with {practiceExam.questions.length} question(s).
              </p>
            ) : (
              <p className="small">No practice exam generated yet.</p>
            )}
            {chatResponse ? (
              <>
                <p className="small">{chatResponse.answer}</p>
                <p className="small mono">{chatResponse.citations.join(", ") || "No citations"}</p>
              </>
            ) : (
              <p className="small">No chat response yet.</p>
            )}
          </div>
          </article>
        </section>
      </main>
    </>
  );
}

export default function HomePage() {
  return <DashboardPage />;
}
