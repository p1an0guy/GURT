import type { PracticeExam } from "../api/types.ts";

const STORAGE_KEY = "gurt.practiceTests.v1";

export interface PracticeTestSummary {
  testId: string;
  title: string;
  courseId: string;
  courseName: string;
  questionCount: number;
  createdAt: string;
}

export interface PracticeTestRecord extends PracticeTestSummary {
  exam: PracticeExam;
}

interface CreatePracticeTestInput {
  courseId: string;
  courseName: string;
  exam: PracticeExam;
  title?: string;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function makeTestId(): string {
  const timestamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ptest_${timestamp}_${rand}`;
}

function readAllPracticeTests(): PracticeTestRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as PracticeTestRecord[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (row) => typeof row.testId === "string" && row.exam && Array.isArray(row.exam.questions),
    );
  } catch {
    return [];
  }
}

function writeAllPracticeTests(tests: PracticeTestRecord[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tests));
}

function toSummary(test: PracticeTestRecord): PracticeTestSummary {
  return {
    testId: test.testId,
    title: test.title,
    courseId: test.courseId,
    courseName: test.courseName,
    questionCount: test.questionCount,
    createdAt: test.createdAt,
  };
}

export function listRecentPracticeTests(limit = 20): PracticeTestSummary[] {
  const tests = readAllPracticeTests();
  return tests
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map(toSummary);
}

export function getPracticeTestById(testId: string): PracticeTestRecord | null {
  const tests = readAllPracticeTests();
  const row = tests.find((test) => test.testId === testId);
  return row ?? null;
}

export function createPracticeTestRecord(input: CreatePracticeTestInput): PracticeTestRecord {
  const now = nowIso();
  const title = input.title?.trim() || `${input.courseName} Practice Test ${now.slice(0, 10)}`;
  const exam: PracticeExam = structuredClone(input.exam);

  const test: PracticeTestRecord = {
    testId: makeTestId(),
    title,
    courseId: input.courseId,
    courseName: input.courseName,
    questionCount: exam.questions.length,
    createdAt: now,
    exam,
  };

  const tests = readAllPracticeTests();
  writeAllPracticeTests([test, ...tests].slice(0, 100));
  return test;
}
