import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "./client.ts";
import type { ReviewEvent } from "./types.ts";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

test("uses fixture mode when explicitly enabled", async () => {
  let fetchCalled = false;
  const fetchImpl: typeof fetch = async () => {
    fetchCalled = true;
    throw new Error("network should not be called in fixture mode");
  };

  const client = createApiClient({
    baseUrl: "https://api.example.dev",
    fetchImpl,
    useFixtures: true,
  });

  const canvasConnect = await client.connectCanvas({
    canvasBaseUrl: "https://canvas.calpoly.edu",
    accessToken: "fixture-token",
  });
  const canvasSync = await client.syncCanvas();
  const generatedCards = await client.generateFlashcards("course-psych-101", 2);
  const exam = await client.generatePracticeExam("course-psych-101", 2);
  const chat = await client.chat("course-psych-101", "What is memory consolidation?");
  const courses = await client.listCourses();
  const cards = await client.getStudyToday("course-psych-101");
  const mastery = await client.getStudyMastery("course-psych-101");
  const calendarToken = await client.createCalendarToken();
  const ingestStart = await client.startDocsIngest({
    docId: "doc-fixture",
    courseId: "course-psych-101",
    key: "uploads/course-psych-101/doc-fixture/syllabus.pdf",
  });
  const ingestStatus = await client.getDocsIngestStatus(ingestStart.jobId);

  assert.equal(fetchCalled, false);
  assert.equal(canvasConnect.connected, true);
  assert.equal(canvasSync.synced, true);
  assert.equal(generatedCards.length, 2);
  assert.equal(exam.questions.length, 2);
  assert.equal(chat.citations.length, 1);
  assert.equal(courses.length, 2);
  assert.ok(cards.length > 0);
  assert.equal(calendarToken.token, "demo-calendar-token");
  assert.equal(ingestStart.status, "RUNNING");
  assert.equal(ingestStatus.status, "RUNNING");
  assert.deepEqual(
    mastery,
    [
      {
        topicId: "topic-memory",
        courseId: "course-psych-101",
        masteryLevel: 0.42,
        dueCards: 3,
      },
      {
        topicId: "topic-conditioning",
        courseId: "course-psych-101",
        masteryLevel: 0.61,
        dueCards: 3,
      },
    ],
  );
});

test("honors USE_FIXTURES env toggle when option is omitted", async () => {
  const priorUseFixtures = process.env.USE_FIXTURES;
  process.env.USE_FIXTURES = "true";

  try {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network should not be called when USE_FIXTURES=true");
    };

    const client = createApiClient({
      baseUrl: "https://api.example.dev",
      fetchImpl,
    });

    const health = await client.getHealth();
    const reviewAck = await client.postStudyReview({
      cardId: "card-001",
      courseId: "course-psych-101",
      rating: 4,
      reviewedAt: "2026-09-01T10:15:00Z",
    });

    assert.deepEqual(health, { status: "ok" });
    assert.deepEqual(reviewAck, { accepted: true });
  } finally {
    if (typeof priorUseFixtures === "undefined") {
      delete process.env.USE_FIXTURES;
    } else {
      process.env.USE_FIXTURES = priorUseFixtures;
    }
  }
});

test("honors NEXT_PUBLIC_USE_FIXTURES env toggle when option is omitted", async () => {
  const priorUseFixtures = process.env.USE_FIXTURES;
  const priorNextPublicUseFixtures = process.env.NEXT_PUBLIC_USE_FIXTURES;
  delete process.env.USE_FIXTURES;
  process.env.NEXT_PUBLIC_USE_FIXTURES = "true";

  try {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network should not be called when NEXT_PUBLIC_USE_FIXTURES=true");
    };

    const client = createApiClient({
      baseUrl: "https://api.example.dev",
      fetchImpl,
    });

    const courses = await client.listCourses();
    assert.equal(courses.length, 2);
  } finally {
    if (typeof priorUseFixtures === "undefined") {
      delete process.env.USE_FIXTURES;
    } else {
      process.env.USE_FIXTURES = priorUseFixtures;
    }

    if (typeof priorNextPublicUseFixtures === "undefined") {
      delete process.env.NEXT_PUBLIC_USE_FIXTURES;
    } else {
      process.env.NEXT_PUBLIC_USE_FIXTURES = priorNextPublicUseFixtures;
    }
  }
});

test("hits contract endpoints when fixture mode is disabled", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : input.toString();
    calls.push({ url, init });

    if (url.endsWith("/health")) {
      return jsonResponse({ status: "ok" });
    }

    if (url.endsWith("/canvas/connect")) {
      return jsonResponse({ connected: true, updatedAt: "2026-09-02T09:00:00Z" });
    }

    if (url.endsWith("/canvas/sync")) {
      return jsonResponse({
        synced: true,
        coursesUpserted: 2,
        itemsUpserted: 3,
        materialsUpserted: 2,
        materialsMirrored: 2,
        knowledgeBaseIngestionStarted: false,
        knowledgeBaseIngestionJobId: "",
        knowledgeBaseIngestionError: "",
        failedCourseIds: [],
        updatedAt: "2026-09-02T09:01:00Z",
      });
    }

    if (url.endsWith("/generate/flashcards")) {
      return jsonResponse([
        {
          id: "card-1",
          courseId: "course-1",
          topicId: "topic-1",
          prompt: "Prompt 1",
          answer: "Answer 1",
        },
      ]);
    }

    if (url.endsWith("/generate/practice-exam")) {
      return jsonResponse({
        courseId: "course-1",
        generatedAt: "2026-09-02T09:00:00Z",
        questions: [
          {
            id: "q-1",
            prompt: "Question 1",
            choices: ["A", "B"],
            answerIndex: 0,
          },
        ],
      });
    }

    if (url.endsWith("/chat")) {
      return jsonResponse({
        answer: "Chat answer",
        citations: ["s3://bucket/path#chunk-1"],
      });
    }

    if (url.endsWith("/courses")) {
      return jsonResponse([{ id: "course-1", name: "Course", term: "Fall", color: "#123456" }]);
    }

    if (url.endsWith("/courses/course%2F1/items")) {
      return jsonResponse([]);
    }

    if (url.includes("/study/today")) {
      return jsonResponse([]);
    }

    if (url.includes("/study/mastery")) {
      return jsonResponse([]);
    }

    if (url.endsWith("/study/review")) {
      return jsonResponse({ accepted: true });
    }

    if (url.endsWith("/calendar/demo%2Ftoken.ics")) {
      return new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
        status: 200,
        headers: {
          "content-type": "text/calendar",
        },
      });
    }

    if (url.endsWith("/calendar/token")) {
      return jsonResponse({
        token: "minted-token",
        feedUrl: "https://api.example.dev/calendar/minted-token.ics",
        createdAt: "2026-09-02T09:00:00Z",
      });
    }

    if (url.endsWith("/docs/ingest")) {
      return jsonResponse({
        jobId: "ingest-123",
        status: "RUNNING",
        updatedAt: "2026-09-02T09:00:00Z",
      });
    }

    if (url.endsWith("/docs/ingest/ingest-123")) {
      return jsonResponse({
        jobId: "ingest-123",
        status: "FINISHED",
        textLength: 1234,
        usedTextract: true,
        updatedAt: "2026-09-02T09:01:00Z",
        error: "",
      });
    }

    return new Response("not found", { status: 404 });
  };

  const client = createApiClient({
    baseUrl: "https://api.example.dev",
    fetchImpl,
    useFixtures: false,
  });

  const reviewEvent: ReviewEvent = {
    cardId: "card-001",
    courseId: "course/1",
    rating: 5,
    reviewedAt: "2026-09-01T10:15:00Z",
  };

  await client.getHealth();
  await client.connectCanvas({
    canvasBaseUrl: "https://canvas.calpoly.edu",
    accessToken: "live-token",
  });
  await client.syncCanvas();
  await client.generateFlashcards("course/1", 2);
  await client.generatePracticeExam("course/1", 2);
  await client.chat("course/1", "What is retrieval practice?");
  await client.listCourses();
  await client.listCourseItems("course/1");
  await client.getStudyToday("course/1");
  await client.getStudyMastery("course/1");
  await client.postStudyReview(reviewEvent);
  const ics = await client.getCalendarIcs("demo/token");
  const tokenResponse = await client.createCalendarToken();
  const ingestStarted = await client.startDocsIngest({
    docId: "doc-1",
    courseId: "course/1",
    key: "uploads/course-1/doc-1/syllabus.pdf",
  });
  const ingestStatus = await client.getDocsIngestStatus(ingestStarted.jobId);

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.equal(tokenResponse.token, "minted-token");
  assert.equal(ingestStatus.status, "FINISHED");
  assert.equal(calls.length, 15);
  assert.ok(calls.some((call) => call.url === "https://api.example.dev/canvas/connect"));
  assert.ok(calls.some((call) => call.url === "https://api.example.dev/canvas/sync"));
  assert.ok(calls.some((call) => call.url === "https://api.example.dev/generate/flashcards"));
  assert.ok(calls.some((call) => call.url === "https://api.example.dev/generate/practice-exam"));
  assert.ok(calls.some((call) => call.url === "https://api.example.dev/chat"));
  assert.ok(calls.some((call) => call.url === "https://api.example.dev/courses/course%2F1/items"));
  assert.ok(calls.some((call) => call.url === "https://api.example.dev/study/today?courseId=course%2F1"));
  assert.ok(calls.some((call) => call.url === "https://api.example.dev/study/mastery?courseId=course%2F1"));

  const reviewCall = calls.find((call) => call.url === "https://api.example.dev/study/review");
  assert.ok(reviewCall);
  assert.equal(reviewCall.init?.method, "POST");
  assert.equal(
    reviewCall.init?.body,
    JSON.stringify({
      cardId: "card-001",
      courseId: "course/1",
      rating: 5,
      reviewedAt: "2026-09-01T10:15:00Z",
    }),
  );

  const calendarTokenCall = calls.find((call) => call.url === "https://api.example.dev/calendar/token");
  assert.ok(calendarTokenCall);
  assert.equal(calendarTokenCall.init?.method, "POST");

  const ingestStartCall = calls.find((call) => call.url === "https://api.example.dev/docs/ingest");
  assert.ok(ingestStartCall);
  assert.equal(ingestStartCall.init?.method, "POST");
});
