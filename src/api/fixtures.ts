import cardsRaw from "../../fixtures/cards.json" with { type: "json" };
import canvasItemsRaw from "../../fixtures/canvas_items.json" with { type: "json" };
import coursesRaw from "../../fixtures/courses.json" with { type: "json" };
import topicsRaw from "../../fixtures/topics.json" with { type: "json" };
import type {
  CanvasConnectRequest,
  CanvasConnectResponse,
  CalendarTokenResponse,
  ChatResponse,
  CanvasItem,
  CanvasSyncResponse,
  Card,
  Course,
  CourseMaterial,
  HealthStatus,
  IngestStartRequest,
  IngestStartResponse,
  IngestStatusResponse,
  PracticeExam,
  StudyReviewAck,
  TopicMastery,
  UploadRequest,
  UploadResponse,
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
let fixtureUploadCounter = 0;

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

export function getFixtureGeneratedFlashcards(courseId: string, numCards: number): Card[] {
  const selected = cards.filter((card) => card.courseId === courseId).slice(0, Math.max(numCards, 1));
  return clone(selected.length > 0 ? selected : cards.slice(0, Math.max(numCards, 1)));
}

export function getFixturePracticeExam(courseId: string, numQuestions: number): PracticeExam {
  const questions = getFixtureGeneratedFlashcards(courseId, numQuestions).map((card, index) => ({
    id: `q-${index + 1}`,
    prompt: card.prompt,
    choices: [card.answer, "Distractor A", "Distractor B"],
    answerIndex: 0,
  }));
  return {
    courseId,
    generatedAt: "2026-09-02T09:10:00Z",
    questions,
  };
}

export function getFixtureChatResponse(courseId: string, question: string): ChatResponse {
  return {
    answer: `Fixture answer for ${courseId}: ${question}`,
    citations: ["s3://fixture/uploads/course-psych-101/syllabus.pdf#chunk-1"],
    citationDetails: [
      {
        source: "s3://fixture/uploads/course-psych-101/syllabus.pdf#chunk-1",
        label: "syllabus.pdf (chunk-1)",
        url: "https://fixture.s3.us-west-2.amazonaws.com/uploads/course-psych-101/syllabus.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=fixture",
      },
    ],
  };
}

export function getFixtureCanvasConnect(_request: CanvasConnectRequest): CanvasConnectResponse {
  return {
    connected: true,
    demoUserId: "canvas-user-fixture",
    updatedAt: "2026-09-02T09:00:00Z",
  };
}

export function getFixtureCanvasSync(): CanvasSyncResponse {
  return {
    synced: true,
    coursesUpserted: 2,
    itemsUpserted: 3,
    materialsUpserted: 2,
    materialsMirrored: 2,
    knowledgeBaseIngestionStarted: true,
    knowledgeBaseIngestionJobId: "kb-job-fixture-1",
    knowledgeBaseIngestionError: "",
    failedCourseIds: [],
    updatedAt: "2026-09-02T09:01:00Z",
  };
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

export function getFixtureUploadResponse(request: UploadRequest): UploadResponse {
  fixtureUploadCounter += 1;
  const docId = `doc-fixture-${fixtureUploadCounter}`;
  const safeFilename = request.filename.replace(/[^A-Za-z0-9._-]/g, "-");

  return {
    docId,
    key: `uploads/${request.courseId}/${docId}/${safeFilename}`,
    uploadUrl: `https://uploads.fixture.local/${docId}`,
    expiresInSeconds: 900,
    contentType: request.contentType,
  };
}

export function getFixtureCourseMaterials(courseId: string): CourseMaterial[] {
  return [
    {
      canvasFileId: "file-101",
      courseId,
      displayName: "Syllabus.pdf",
      contentType: "application/pdf",
      sizeBytes: 245_000,
      updatedAt: "2026-01-15T08:00:00Z",
    },
    {
      canvasFileId: "file-102",
      courseId,
      displayName: "Lecture 1 - Introduction.pdf",
      contentType: "application/pdf",
      sizeBytes: 1_200_000,
      updatedAt: "2026-01-20T10:30:00Z",
    },
    {
      canvasFileId: "file-103",
      courseId,
      displayName: "Chapter 3 Notes.txt",
      contentType: "text/plain",
      sizeBytes: 18_500,
      updatedAt: "2026-02-01T14:15:00Z",
    },
  ];
}

export function getFixtureGeneratedFlashcardsFromMaterials(
  courseId: string,
  _materialIds: string[],
  numCards: number,
): Card[] {
  return getFixtureGeneratedFlashcards(courseId, numCards);
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
