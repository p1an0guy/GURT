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
}

export interface TopicMastery {
  topicId: string;
  courseId: string;
  masteryLevel: number;
  dueCards: number;
}
