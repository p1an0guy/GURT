"use client";

import { useMemo, useState } from "react";

import { createApiClient } from "../src/api/client.ts";
import type { CanvasItem, Course, TopicMastery } from "../src/api/types.ts";

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

  return (
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
            <button type="button" onClick={handleSubmitReview}>
              Send Review Event
            </button>
            <button type="button" onClick={handleMintCalendarToken}>
              Mint Calendar Token
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
      </section>
    </main>
  );
}
