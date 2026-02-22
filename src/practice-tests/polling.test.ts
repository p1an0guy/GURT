import assert from "node:assert/strict";
import test from "node:test";

import type { PracticeExamGenerationStatusResponse } from "../api/types.ts";
import { pollPracticeExamJob } from "./polling.ts";

function makeStatus(
  status: PracticeExamGenerationStatusResponse["status"],
): PracticeExamGenerationStatusResponse {
  return {
    jobId: "pracexam-123",
    status,
    updatedAt: "2026-02-22T18:00:00Z",
  };
}

test("pollPracticeExamJob returns exam when FINISHED", async () => {
  const waits: number[] = [];
  const statuses: PracticeExamGenerationStatusResponse[] = [
    makeStatus("RUNNING"),
    {
      ...makeStatus("FINISHED"),
      exam: {
        courseId: "course-psych-101",
        generatedAt: "2026-02-22T18:00:12Z",
        questions: [],
      },
    },
  ];
  let calls = 0;

  const exam = await pollPracticeExamJob({
    jobId: "pracexam-123",
    maxAttempts: 5,
    waitMs: 4000,
    getStatus: async () => {
      const current = statuses[Math.min(calls, statuses.length - 1)];
      calls += 1;
      return current;
    },
    wait: async (ms) => {
      waits.push(ms);
    },
  });

  assert.equal(exam.courseId, "course-psych-101");
  assert.equal(calls, 2);
  assert.deepEqual(waits, [4000]);
});

test("pollPracticeExamJob throws FAILED error immediately", async () => {
  const waits: number[] = [];

  await assert.rejects(
    pollPracticeExamJob({
      jobId: "pracexam-123",
      maxAttempts: 5,
      waitMs: 4000,
      getStatus: async () => ({
        ...makeStatus("FAILED"),
        error: "generator failed",
      }),
      wait: async (ms) => {
        waits.push(ms);
      },
    }),
    /generator failed/,
  );

  assert.deepEqual(waits, []);
});

test("pollPracticeExamJob times out without extra final wait", async () => {
  let statusCalls = 0;
  const waits: number[] = [];

  await assert.rejects(
    pollPracticeExamJob({
      jobId: "pracexam-123",
      maxAttempts: 3,
      waitMs: 4000,
      getStatus: async () => {
        statusCalls += 1;
        return makeStatus("RUNNING");
      },
      wait: async (ms) => {
        waits.push(ms);
      },
    }),
    /timed out/i,
  );

  assert.equal(statusCalls, 3);
  assert.deepEqual(waits, [4000, 4000]);
});
