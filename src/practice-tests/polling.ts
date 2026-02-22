import type { PracticeExam, PracticeExamGenerationStatusResponse } from "../api/types.ts";

export interface PollPracticeExamJobOptions {
  jobId: string;
  maxAttempts: number;
  waitMs: number;
  getStatus: (jobId: string) => Promise<PracticeExamGenerationStatusResponse>;
  wait: (ms: number) => Promise<void>;
}

export async function pollPracticeExamJob(options: PollPracticeExamJobOptions): Promise<PracticeExam> {
  const { jobId, maxAttempts, waitMs, getStatus, wait } = options;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const status = await getStatus(jobId);
    if (status.status === "FINISHED" && status.exam) {
      return status.exam;
    }
    if (status.status === "FAILED") {
      throw new Error(status.error || "Practice exam generation failed.");
    }
    if (attempt < maxAttempts - 1) {
      await wait(waitMs);
    }
  }
  throw new Error("Practice exam generation timed out. Try again.");
}
