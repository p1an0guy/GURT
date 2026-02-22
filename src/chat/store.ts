import type { ChatCitation } from "../api/types.ts";

const SELECTED_COURSE_KEY = "gurt.chat.v1.selectedCourseId";
const HISTORY_KEY_PREFIX = "gurt.chat.v1.history.";
const MAX_HISTORY_LENGTH = 100;

export type ChatMessageRole = "user" | "assistant" | "error";

export interface ChatMessage {
  role: ChatMessageRole;
  text: string;
  citations?: ChatCitation[];
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeCourseId(courseId: string): string {
  return courseId.trim();
}

function isHttpsUrl(value: string): boolean {
  return value.startsWith("https://");
}

function normalizeCitations(raw: unknown): ChatCitation[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const citations: ChatCitation[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const source = typeof entry.source === "string" ? entry.source.trim() : "";
    const label = typeof entry.label === "string" ? entry.label.trim() : "";
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!source || !label || !isHttpsUrl(url) || seen.has(url)) {
      continue;
    }
    seen.add(url);
    citations.push({ source, label, url });
  }

  return citations;
}

function normalizeMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const role =
    candidate.role === "user" || candidate.role === "assistant" || candidate.role === "error"
      ? candidate.role
      : null;
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";

  if (!role || !text) {
    return null;
  }

  const normalized: ChatMessage = {
    role,
    text,
  };
  const citations = normalizeCitations(candidate.citations);
  if (citations.length > 0) {
    normalized.citations = citations;
  }
  return normalized;
}

function normalizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const messages: ChatMessage[] = [];
  for (const entry of raw) {
    const message = normalizeMessage(entry);
    if (message) {
      messages.push(message);
    }
  }
  if (messages.length <= MAX_HISTORY_LENGTH) {
    return messages;
  }
  return messages.slice(messages.length - MAX_HISTORY_LENGTH);
}

function historyStorageKey(courseId: string): string {
  return `${HISTORY_KEY_PREFIX}${courseId}`;
}

export function readSelectedCourseId(): string | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const value = storage.getItem(SELECTED_COURSE_KEY);
    if (!value) {
      return null;
    }
    const courseId = normalizeCourseId(value);
    return courseId || null;
  } catch {
    return null;
  }
}

export function writeSelectedCourseId(courseId: string | null): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const normalized = typeof courseId === "string" ? normalizeCourseId(courseId) : "";
  try {
    if (!normalized) {
      storage.removeItem(SELECTED_COURSE_KEY);
      return;
    }
    storage.setItem(SELECTED_COURSE_KEY, normalized);
  } catch {
    // Best-effort local persistence.
  }
}

export function readCourseHistory(courseId: string): ChatMessage[] {
  const normalizedCourseId = normalizeCourseId(courseId);
  if (!normalizedCourseId) {
    return [];
  }

  const storage = getStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(historyStorageKey(normalizedCourseId));
    if (!raw) {
      return [];
    }
    return normalizeHistory(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeCourseHistory(courseId: string, history: ChatMessage[]): void {
  const normalizedCourseId = normalizeCourseId(courseId);
  if (!normalizedCourseId) {
    return;
  }

  const storage = getStorage();
  if (!storage) {
    return;
  }

  const normalizedHistory = normalizeHistory(history);
  const key = historyStorageKey(normalizedCourseId);

  try {
    if (normalizedHistory.length === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(normalizedHistory));
  } catch {
    // Best-effort local persistence.
  }
}
