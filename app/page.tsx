"use client";

import { useMemo, useState } from "react";

import { createApiClient } from "../src/api/client.ts";
import type {
  CanvasItem,
  CanvasSyncResponse,
  Card,
  ChatResponse,
  Course,
  IngestStatusResponse,
  PracticeExam,
  TopicMastery,
} from "../src/api/types.ts";

const DEFAULT_COURSE_ID = "course-psych-101";
const DEFAULT_CALENDAR_TOKEN =
  process.env.NEXT_PUBLIC_CALENDAR_TOKEN ?? "demo-calendar-token";

function toNowRfc3339(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export default function HomePage() {
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
  const [numCards, setNumCards] = useState("10");
  const [numQuestions, setNumQuestions] = useState("10");
  const [generatedCards, setGeneratedCards] = useState<Card[]>([]);
  const [practiceExam, setPracticeExam] = useState<PracticeExam | null>(null);
  const [chatQuestion, setChatQuestion] = useState("What are the most important topics this week?");
  const [chatResponse, setChatResponse] = useState<ChatResponse | null>(null);
  const [ingestDocId, setIngestDocId] = useState("");
  const [ingestKey, setIngestKey] = useState("");
  const [ingestStatus, setIngestStatus] = useState<IngestStatusResponse | null>(null);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [health, setHealth] = useState<string>("unknown");
  const [courses, setCourses] = useState<Course[]>([]);
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [mastery, setMastery] = useState<TopicMastery[]>([]);
  const [calendarUrl, setCalendarUrl] = useState<string>("");
  const [message, setMessage] = useState<string>("");

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
    try {
      const sync = await client.syncCanvas();
      setLastCanvasSync(sync);
      const failed = sync.failedCourseIds.length > 0 ? ` (failed: ${sync.failedCourseIds.join(", ")})` : "";
      setMessage(
        `Canvas sync: ${sync.coursesUpserted} course(s), ${sync.itemsUpserted} item(s), ${sync.materialsMirrored} material(s) mirrored${failed}.`,
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
      setMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function handleStartIngest(): Promise<void> {
    setMessage("");
    setIngestLoading(true);
    setIngestStatus(null);
    try {
      const started = await client.startDocsIngest({
        docId: ingestDocId,
        courseId,
        key: ingestKey,
      });

      let status = await client.getDocsIngestStatus(started.jobId);
      while (status.status === "RUNNING") {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        status = await client.getDocsIngestStatus(started.jobId);
      }
      setIngestStatus(status);
      if (status.status === "FINISHED") {
        setMessage(`Ingest finished. Extracted ${status.textLength} chars.`);
      } else {
        setMessage(`Ingest failed: ${status.error || "unknown error"}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIngestLoading(false);
    }
  }

  async function handleGenerateFlashcards(): Promise<void> {
    setMessage("");
    try {
      const requested = Number.parseInt(numCards, 10);
      const cards = await client.generateFlashcards(courseId, Number.isNaN(requested) ? 10 : requested);
      setGeneratedCards(cards);
      setMessage(`Generated ${cards.length} flashcard(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function handleGeneratePracticeExam(): Promise<void> {
    setMessage("");
    try {
      const requested = Number.parseInt(numQuestions, 10);
      const exam = await client.generatePracticeExam(courseId, Number.isNaN(requested) ? 10 : requested);
      setPracticeExam(exam);
      setMessage(`Generated practice exam with ${exam.questions.length} question(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function handleChatAsk(): Promise<void> {
    setMessage("");
    try {
      const response = await client.chat(courseId, chatQuestion);
      setChatResponse(response);
      setMessage("Chat response loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  return (
    <>
      {ingestLoading && (
        <div className="loading-screen" role="status" aria-live="polite">
          <div className="loading-card">
            <h2>Processing Document</h2>
            <p>Waiting for ingest workflow to finish...</p>
          </div>
        </div>
      )}
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
            <button type="button" onClick={handleCanvasSync}>
              Sync Canvas
            </button>
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
              placeholder="doc-123"
            />

            <label htmlFor="ingestKey">Ingest S3 Key</label>
            <input
              id="ingestKey"
              value={ingestKey}
              onChange={(event) => setIngestKey(event.target.value)}
              placeholder="uploads/course-id/doc-id/file.pdf"
            />

            <button type="button" onClick={handleStartIngest} disabled={ingestLoading}>
              {ingestLoading ? "Ingesting..." : "Start Ingest"}
            </button>

            <label htmlFor="numCards">Generate Flashcards</label>
            <input
              id="numCards"
              value={numCards}
              onChange={(event) => setNumCards(event.target.value)}
              placeholder="10"
            />
            <button type="button" onClick={handleGenerateFlashcards}>
              Generate Cards
            </button>

            <label htmlFor="numQuestions">Generate Practice Exam</label>
            <input
              id="numQuestions"
              value={numQuestions}
              onChange={(event) => setNumQuestions(event.target.value)}
              placeholder="10"
            />
            <button type="button" onClick={handleGeneratePracticeExam}>
              Generate Exam
            </button>

            <label htmlFor="chatQuestion">Chat Question</label>
            <input
              id="chatQuestion"
              value={chatQuestion}
              onChange={(event) => setChatQuestion(event.target.value)}
              placeholder="Ask a course question"
            />
            <button type="button" onClick={handleChatAsk}>
              Ask Chat
            </button>
          </div>
          </article>

          <article className="panel">
          <h2>Status</h2>
          <div className="stack">
            <p className={`status ${health === "ok" ? "ok" : "warn"}`}>
              Health: {health}
            </p>
            <p className="small">{message || "No requests yet."}</p>
            {lastCanvasSync && (
              <p className="small">
                Last Canvas sync: {lastCanvasSync.updatedAt} ({lastCanvasSync.itemsUpserted} items,{" "}
                {lastCanvasSync.materialsMirrored} mirrored)
              </p>
            )}
            {ingestStatus && (
              <p className="small">
                Ingest job {ingestStatus.jobId}: {ingestStatus.status} (text {ingestStatus.textLength}, Textract{" "}
                {ingestStatus.usedTextract ? "yes" : "no"})
              </p>
            )}
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
