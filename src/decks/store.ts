import type { Card, Course } from "../api/types.ts";

const STORAGE_KEY = "gurt.decks.v1";

export interface DeckSummary {
  deckId: string;
  title: string;
  courseId: string;
  courseName: string;
  resourceLabels: string[];
  cardCount: number;
  createdAt: string;
  lastStudiedAt: string;
}

export interface DeckRecord extends DeckSummary {
  cards: Card[];
}

interface CreateDeckInput {
  title: string;
  courseId: string;
  courseName: string;
  resourceLabels: string[];
  cards: Card[];
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function makeDeckId(): string {
  const timestamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `deck_${timestamp}_${rand}`;
}

function readAllDecks(): DeckRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as DeckRecord[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((row) => typeof row.deckId === "string" && Array.isArray(row.cards));
  } catch {
    return [];
  }
}

function writeAllDecks(decks: DeckRecord[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

function toSummary(deck: DeckRecord): DeckSummary {
  return {
    deckId: deck.deckId,
    title: deck.title,
    courseId: deck.courseId,
    courseName: deck.courseName,
    resourceLabels: [...deck.resourceLabels],
    cardCount: deck.cardCount,
    createdAt: deck.createdAt,
    lastStudiedAt: deck.lastStudiedAt,
  };
}

export function listRecentDecks(limit = 12): DeckSummary[] {
  const decks = readAllDecks();
  return decks
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map(toSummary);
}

export function getDeckById(deckId: string): DeckRecord | null {
  const decks = readAllDecks();
  const row = decks.find((deck) => deck.deckId === deckId);
  return row ?? null;
}

export function createDeckRecord(input: CreateDeckInput): DeckRecord {
  const now = nowIso();
  const title = input.title.trim() || `${input.courseName} Deck ${now.slice(0, 10)}`;
  const labels = input.resourceLabels.map(normalizeLabel).filter(Boolean);
  const cards = input.cards.map((card) => ({ ...card }));

  const deck: DeckRecord = {
    deckId: makeDeckId(),
    title,
    courseId: input.courseId,
    courseName: input.courseName,
    resourceLabels: labels,
    cardCount: cards.length,
    createdAt: now,
    lastStudiedAt: "",
    cards,
  };

  const decks = readAllDecks();
  writeAllDecks([deck, ...decks].slice(0, 100));
  return deck;
}

export function markDeckStudied(deckId: string): void {
  const decks = readAllDecks();
  const updated = decks.map((deck) =>
    deck.deckId === deckId
      ? {
          ...deck,
          lastStudiedAt: nowIso(),
        }
      : deck,
  );
  writeAllDecks(updated);
}

export function resolveCourseName(courses: Course[], courseId: string): string {
  const course = courses.find((row) => row.id === courseId);
  return course?.name ?? courseId;
}
