import {
  getFixtureChatResponse,
  getFixtureCanvasConnect,
  getFixtureCanvasSync,
  getFixtureCalendarIcs,
  getFixtureCalendarTokenResponse,
  getFixtureCourseItems,
  getFixtureGeneratedFlashcards,
  getFixtureCourses,
  getFixtureHealth,
  getFixtureIngestStartResponse,
  getFixtureIngestStatusResponse,
  getFixturePracticeExam,
  getFixtureStudyMastery,
  getFixtureStudyReviewAck,
  getFixtureStudyToday,
} from "./fixtures.ts";
import type {
  CanvasConnectRequest,
  CanvasConnectResponse,
  CalendarTokenResponse,
  ChatResponse,
  CanvasItem,
  CanvasSyncResponse,
  Card,
  Course,
  HealthStatus,
  IngestStartRequest,
  IngestStartResponse,
  IngestStatusResponse,
  PracticeExam,
  ReviewEvent,
  StudyReviewAck,
  TopicMastery,
} from "./types.ts";

type FetchLike = typeof fetch;
type EnvMap = Record<string, string | undefined>;

declare const process:
  | {
      env?: EnvMap;
    }
  | undefined;

export interface ApiClient {
  getHealth(): Promise<HealthStatus>;
  connectCanvas(request: CanvasConnectRequest): Promise<CanvasConnectResponse>;
  syncCanvas(): Promise<CanvasSyncResponse>;
  generateFlashcards(courseId: string, numCards: number): Promise<Card[]>;
  generatePracticeExam(courseId: string, numQuestions: number): Promise<PracticeExam>;
  chat(courseId: string, question: string): Promise<ChatResponse>;
  listCourses(): Promise<Course[]>;
  listCourseItems(courseId: string): Promise<CanvasItem[]>;
  getStudyToday(courseId: string): Promise<Card[]>;
  postStudyReview(reviewEvent: ReviewEvent): Promise<StudyReviewAck>;
  getStudyMastery(courseId: string): Promise<TopicMastery[]>;
  getCalendarIcs(token: string): Promise<string>;
  createCalendarToken(): Promise<CalendarTokenResponse>;
  startDocsIngest(request: IngestStartRequest): Promise<IngestStartResponse>;
  getDocsIngestStatus(jobId: string): Promise<IngestStatusResponse>;
}

export interface CreateApiClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
  useFixtures?: boolean;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly statusText: string;

  public constructor(status: number, statusText: string, body?: string) {
    const details = body ? `: ${body}` : "";
    super(`API request failed (${status} ${statusText})${details}`);
    this.name = "ApiClientError";
    this.status = status;
    this.statusText = statusText;
  }
}

function readFixtureModeEnv(): boolean {
  // In Next.js browser bundles, `process.env.NEXT_PUBLIC_*` is inlined at build time.
  const processEnv = typeof process === "undefined" ? undefined : process.env;
  const importMetaEnv = (import.meta as { env?: EnvMap }).env;
  const raw =
    processEnv?.USE_FIXTURES ??
    processEnv?.NEXT_PUBLIC_USE_FIXTURES ??
    importMetaEnv?.USE_FIXTURES ??
    importMetaEnv?.NEXT_PUBLIC_USE_FIXTURES;

  if (!raw) {
    return false;
  }

  return raw.toLowerCase() === "true" || raw === "1";
}

function joinPath(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (!normalizedBase) {
    return normalizedPath;
  }

  return `${normalizedBase}${normalizedPath}`;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string>): string {
  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(baseUrl);

  if (hasScheme) {
    const absoluteBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const url = new URL(path, absoluteBase);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  const joined = joinPath(baseUrl, path);

  if (!query || Object.keys(query).length === 0) {
    return joined;
  }

  const params = new URLSearchParams(query);
  return `${joined}?${params.toString()}`;
}

async function parseError(response: Response): Promise<ApiClientError> {
  const body = await response.text();
  return new ApiClientError(response.status, response.statusText, body || undefined);
}

export function createApiClient(options: CreateApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const useFixtures = options.useFixtures ?? readFixtureModeEnv();

  async function requestJson<T>(
    path: string,
    init?: RequestInit,
    query?: Record<string, string>,
  ): Promise<T> {
    const response = await fetchImpl(buildUrl(options.baseUrl, path, query), init);

    if (!response.ok) {
      throw await parseError(response);
    }

    return (await response.json()) as T;
  }

  async function requestText(
    path: string,
    init?: RequestInit,
    query?: Record<string, string>,
  ): Promise<string> {
    const response = await fetchImpl(buildUrl(options.baseUrl, path, query), init);

    if (!response.ok) {
      throw await parseError(response);
    }

    return response.text();
  }

  return {
    async getHealth(): Promise<HealthStatus> {
      if (useFixtures) {
        return getFixtureHealth();
      }

      return requestJson<HealthStatus>("/health");
    },

    async connectCanvas(request: CanvasConnectRequest): Promise<CanvasConnectResponse> {
      if (useFixtures) {
        return getFixtureCanvasConnect(request);
      }
      return requestJson<CanvasConnectResponse>("/canvas/connect", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      });
    },

    async syncCanvas(): Promise<CanvasSyncResponse> {
      if (useFixtures) {
        return getFixtureCanvasSync();
      }
      return requestJson<CanvasSyncResponse>("/canvas/sync", {
        method: "POST",
      });
    },

    async generateFlashcards(courseId: string, numCards: number): Promise<Card[]> {
      if (useFixtures) {
        return getFixtureGeneratedFlashcards(courseId, numCards);
      }
      return requestJson<Card[]>("/generate/flashcards", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ courseId, numCards }),
      });
    },

    async generatePracticeExam(courseId: string, numQuestions: number): Promise<PracticeExam> {
      if (useFixtures) {
        return getFixturePracticeExam(courseId, numQuestions);
      }
      return requestJson<PracticeExam>("/generate/practice-exam", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ courseId, numQuestions }),
      });
    },

    async chat(courseId: string, question: string): Promise<ChatResponse> {
      if (useFixtures) {
        return getFixtureChatResponse(courseId, question);
      }
      return requestJson<ChatResponse>("/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ courseId, question }),
      });
    },

    async listCourses(): Promise<Course[]> {
      if (useFixtures) {
        return getFixtureCourses();
      }

      return requestJson<Course[]>("/courses");
    },

    async listCourseItems(courseId: string): Promise<CanvasItem[]> {
      if (useFixtures) {
        return getFixtureCourseItems(courseId);
      }

      return requestJson<CanvasItem[]>(`/courses/${encodeURIComponent(courseId)}/items`);
    },

    async getStudyToday(courseId: string): Promise<Card[]> {
      if (useFixtures) {
        return getFixtureStudyToday(courseId);
      }

      return requestJson<Card[]>("/study/today", undefined, { courseId });
    },

    async postStudyReview(reviewEvent: ReviewEvent): Promise<StudyReviewAck> {
      if (useFixtures) {
        return getFixtureStudyReviewAck();
      }

      return requestJson<StudyReviewAck>("/study/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(reviewEvent),
      });
    },

    async getStudyMastery(courseId: string): Promise<TopicMastery[]> {
      if (useFixtures) {
        return getFixtureStudyMastery(courseId);
      }

      return requestJson<TopicMastery[]>("/study/mastery", undefined, { courseId });
    },

    async getCalendarIcs(token: string): Promise<string> {
      if (useFixtures) {
        return getFixtureCalendarIcs(token);
      }

      return requestText(`/calendar/${encodeURIComponent(token)}.ics`);
    },

    async createCalendarToken(): Promise<CalendarTokenResponse> {
      if (useFixtures) {
        return getFixtureCalendarTokenResponse(options.baseUrl);
      }

      return requestJson<CalendarTokenResponse>("/calendar/token", {
        method: "POST",
      });
    },

    async startDocsIngest(request: IngestStartRequest): Promise<IngestStartResponse> {
      if (useFixtures) {
        return getFixtureIngestStartResponse(request);
      }
      return requestJson<IngestStartResponse>("/docs/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      });
    },

    async getDocsIngestStatus(jobId: string): Promise<IngestStatusResponse> {
      if (useFixtures) {
        return getFixtureIngestStatusResponse(jobId);
      }
      return requestJson<IngestStatusResponse>(`/docs/ingest/${encodeURIComponent(jobId)}`);
    },
  };
}
