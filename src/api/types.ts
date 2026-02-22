export interface HealthStatus {
  status: "ok";
}

export interface Course {
  id: string;
  name: string;
  term: string;
  color: string;
}

export type CanvasItemType = "assignment" | "exam" | "quiz";

export interface CanvasItem {
  id: string;
  courseId: string;
  title: string;
  itemType: CanvasItemType;
  dueAt: string;
  pointsPossible: number;
}

export interface CanvasConnectRequest {
  canvasBaseUrl: string;
  accessToken: string;
}

export interface CanvasConnectResponse {
  connected: boolean;
  demoUserId?: string;
  updatedAt: string;
}

export interface CanvasSyncResponse {
  synced: boolean;
  coursesUpserted: number;
  itemsUpserted: number;
  materialsUpserted: number;
  materialsMirrored: number;
  knowledgeBaseIngestionStarted: boolean;
  knowledgeBaseIngestionJobId: string;
  knowledgeBaseIngestionError: string;
  failedCourseIds: string[];
  updatedAt: string;
}

export interface ChatResponse {
  answer: string;
  citations: string[];
  citationDetails?: ChatCitation[];
}

export interface ChatCitation {
  source: string;
  label: string;
  url: string;
}

export interface Card {
  id: string;
  courseId: string;
  topicId: string;
  prompt: string;
  answer: string;
}

export interface ReviewEvent {
  cardId: string;
  courseId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  reviewedAt: string;
}

export interface StudyReviewAck {
  accepted: boolean;
}

export interface CalendarTokenResponse {
  token: string;
  feedUrl: string;
  createdAt: string;
}

export interface UploadRequest {
  courseId: string;
  filename: string;
  contentType:
    | "application/pdf"
    | "text/plain"
    | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    | "application/msword";
  contentLengthBytes?: number;
}

export interface UploadResponse {
  docId: string;
  key: string;
  uploadUrl: string;
  expiresInSeconds: number;
  contentType: UploadRequest["contentType"];
}

export interface IngestStartRequest {
  docId: string;
  courseId: string;
  key: string;
}

export interface IngestStartResponse {
  jobId: string;
  status: "RUNNING";
  updatedAt: string;
}

export type IngestStatus = "RUNNING" | "FINISHED" | "FAILED";

export interface IngestStatusResponse {
  jobId: string;
  status: IngestStatus;
  textLength: number;
  usedTextract: boolean;
  updatedAt: string;
  error: string;
  kbIngestionJobId?: string;
  kbIngestionError?: string;
}

export interface TopicMastery {
  topicId: string;
  courseId: string;
  masteryLevel: number;
  dueCards: number;
}

export interface CourseMaterial {
  canvasFileId: string;
  courseId: string;
  displayName: string;
  contentType: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface PracticeExamQuestion {
  id: string;
  prompt: string;
  choices: string[];
  answerIndex: number;
}

export interface PracticeExam {
  courseId: string;
  generatedAt: string;
  questions: PracticeExamQuestion[];
}
