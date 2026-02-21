import cardsRaw from "../../fixtures/cards.json" with { type: "json" };
import canvasItemsRaw from "../../fixtures/canvas_items.json" with { type: "json" };
import coursesRaw from "../../fixtures/courses.json" with { type: "json" };
import topicsRaw from "../../fixtures/topics.json" with { type: "json" };
import type {
  CalendarTokenResponse,
  CanvasItem,
  Card,
  Course,
  HealthStatus,
  IngestStartRequest,
  IngestStartResponse,
  IngestStatusResponse,
  StudyReviewAck,
  TopicMastery,
} from "./types.ts";

interface TopicFixture {
  id: string;
  courseId: string;
  name: string;
  masteryLevel: number;
}

const courses = coursesRaw as Course[];
const canvasItems = canvasItemsRaw as CanvasItem[];
const cards = cardsRaw as Card[];
const topics = topicsRaw as TopicFixture[];
const ingestPollCountByJobId: Record<string, number> = {};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function getFixtureHealth(): HealthStatus {
  return { status: "ok" };
}

export function getFixtureCourses(): Course[] {
  return clone(courses);
}

export function getFixtureCourseItems(courseId: string): CanvasItem[] {
  return clone(canvasItems.filter((item) => item.courseId === courseId));
}

export function getFixtureStudyToday(courseId: string): Card[] {
  return clone(cards.filter((card) => card.courseId === courseId));
}

export function getFixtureStudyMastery(courseId: string): TopicMastery[] {
  const dueCountsByTopic: Record<string, number> = {};

  for (const card of cards) {
    if (card.courseId !== courseId) {
      continue;
    }

    dueCountsByTopic[card.topicId] = (dueCountsByTopic[card.topicId] ?? 0) + 1;
  }

  return clone(
    topics
      .filter((topic) => topic.courseId === courseId)
      .map((topic) => ({
        topicId: topic.id,
        courseId: topic.courseId,
        masteryLevel: topic.masteryLevel,
        dueCards: dueCountsByTopic[topic.id] ?? 0,
      })),
  );
}

export function getFixtureStudyReviewAck(): StudyReviewAck {
  return { accepted: true };
}

export function getFixtureCalendarIcs(token: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GURT//StudyBuddy//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const item of canvasItems) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${item.id}@gurt-demo`);
    lines.push(`SUMMARY:${item.title}`);
    lines.push(`DTSTART:${item.dueAt.replace(/[-:]/g, "").replace(".000", "")}`);
    lines.push(`DTEND:${item.dueAt.replace(/[-:]/g, "").replace(".000", "")}`);
    lines.push(`DESCRIPTION:courseId=${item.courseId};type=${item.itemType};token=${token}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return `${lines.join("\r\n")}\r\n`;
}

export function getFixtureCalendarTokenResponse(baseUrl: string): CalendarTokenResponse {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const token = "demo-calendar-token";
  const feedUrl = normalized
    ? `${normalized}/calendar/${token}.ics`
    : `/calendar/${token}.ics`;
  return {
    token,
    feedUrl,
    createdAt: "2026-09-02T09:00:00Z",
  };
}

export function getFixtureIngestStartResponse(request: IngestStartRequest): IngestStartResponse {
  const jobId = `ingest-${request.docId}`;
  ingestPollCountByJobId[jobId] = 0;
  return {
    jobId,
    status: "RUNNING",
    updatedAt: "2026-09-02T09:00:00Z",
  };
}

export function getFixtureIngestStatusResponse(jobId: string): IngestStatusResponse {
  ingestPollCountByJobId[jobId] = (ingestPollCountByJobId[jobId] ?? 0) + 1;
  const finished = ingestPollCountByJobId[jobId] >= 2;
  return {
    jobId,
    status: finished ? "FINISHED" : "RUNNING",
    textLength: finished ? 1024 : 0,
    usedTextract: finished,
    updatedAt: "2026-09-02T09:00:00Z",
    error: "",
  };
}
