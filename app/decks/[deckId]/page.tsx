"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import "katex/dist/katex.min.css";

import { createApiClient } from "../../../src/api/client.ts";
import { MathText } from "../../../src/components/MathText.tsx";
import { getDeckById, markDeckStudied, type DeckRecord } from "../../../src/decks/store.ts";
import { getDefaultRuntimeSettings } from "../../../src/runtime-settings.ts";

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

type RecallRating = 1 | 2 | 3 | 4;

const SHORTCUT_WARNING = "Must rate recall quality before continuing.";
const SPACE_WARNING_THRESHOLD = 3;
const RATING_LABELS: Record<RecallRating, string> = {
  1: "Forgot",
  2: "Hard",
  3: "Good",
  4: "Easy",
};

export default function DeckStudyPage() {
  const params = useParams<{ deckId: string }>();
  const router = useRouter();
  const deckId = typeof params.deckId === "string" ? params.deckId : "";
  const [deck, setDeck] = useState<DeckRecord | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [spacePressCount, setSpacePressCount] = useState(0);
  const [shortcutWarning, setShortcutWarning] = useState("");

  const [settings] = useState(getDefaultRuntimeSettings);
  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: settings.baseUrl,
        useFixtures: settings.useFixtures,
      }),
    [settings.baseUrl, settings.useFixtures],
  );

  useEffect(() => {
    if (!deckId) {
      return;
    }
    const row = getDeckById(deckId);
    setDeck(row);
  }, [deckId]);

  const activeCard = deck?.cards[activeIndex];
  const isFinished = deck !== null && activeIndex >= deck.cards.length;

  async function handleRate(rating: RecallRating): Promise<void> {
    if (!deck || !activeCard || isSubmittingReview) {
      return;
    }

    setError("");
    setMessage("");
    setIsSubmittingReview(true);
    try {
      await client.postStudyReview({
        cardId: activeCard.id,
        courseId: deck.courseId,
        rating,
        reviewedAt: nowIso(),
      });
      markDeckStudied(deck.deckId);
      setActiveIndex((prev) => prev + 1);
      setRevealed(false);
      setSpacePressCount(0);
      setShortcutWarning("");
      setMessage(`Saved rating: ${RATING_LABELS[rating]}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to submit review");
    } finally {
      setIsSubmittingReview(false);
    }
  }

  useEffect(() => {
    if (!isFinished) {
      return;
    }
    setSpacePressCount(0);
    setShortcutWarning("");
  }, [isFinished]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (isFinished && event.code === "Space") {
        event.preventDefault();
        router.push("/");
        return;
      }

      if (!deck || !activeCard || isSubmittingReview) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        setSpacePressCount((prev) => {
          const next = prev + 1;
          if (next >= SPACE_WARNING_THRESHOLD) {
            setShortcutWarning(SHORTCUT_WARNING);
          }
          return next;
        });
        setRevealed((prev) => !prev);
        return;
      }

      let rating: RecallRating | null = null;
      switch (event.code) {
        case "Digit1":
        case "Numpad1":
          rating = 1;
          break;
        case "Digit2":
        case "Numpad2":
          rating = 2;
          break;
        case "Digit3":
        case "Numpad3":
          rating = 3;
          break;
        case "Digit4":
        case "Numpad4":
          rating = 4;
          break;
        default:
          break;
      }

      if (rating !== null) {
        event.preventDefault();
        void handleRate(rating);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeCard, deck, handleRate, isFinished, isSubmittingReview, router]);

  if (!deck) {
    return (
      <main className="page">
        <section className="hero">
          <h1>Deck Not Found</h1>
          <p>This deck may have been removed from local browser storage.</p>
          <p>
            <Link href="/">Back to dashboard</Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="hero">
        <h1>{deck.title}</h1>
        <p>
          {deck.courseName} · {deck.cardCount} cards
        </p>
        <p>
          <Link href="/">Back to dashboard</Link>
        </p>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <h2>Study Session</h2>
          {isFinished ? (
            <div className="stack">
              <p className="small">Deck complete. Nice work.</p>
              <Link className="button-link" href="/">
                Return to dashboard
              </Link>
            </div>
          ) : activeCard ? (
            <div className="stack">
              <p className="small">
                Card {activeIndex + 1} of {deck.cards.length}
              </p>
              <button
                type="button"
                className="flashcard-flip"
                onClick={() => setRevealed((prev) => !prev)}
                aria-label={revealed ? "Show prompt side of card" : "Show answer side of card"}
              >
                <div className={`flashcard-flip-inner${revealed ? " is-revealed" : ""}`}>
                  <div className="flashcard-face flashcard-front">
                    <p className="flashcard-side-label">Prompt</p>
                    <p className="flashcard-side-text"><MathText text={activeCard.prompt} /></p>
                  </div>
                  <div className="flashcard-face flashcard-back">
                    <p className="flashcard-side-label">Answer</p>
                    <p className="flashcard-side-text"><MathText text={activeCard.answer} /></p>
                  </div>
                </div>
              </button>

              <div>
                <p className="small">Click card or press Space to flip</p>
                <p className="small">Rate recall quality:</p>
                <p className="small">1: Forgot, 2: Hard, 3: Good, 4: Easy</p>
                <div className="rating-row">
                  <button type="button" onClick={() => void handleRate(1)} disabled={isSubmittingReview}>
                    Forgot
                  </button>
                  <button type="button" onClick={() => void handleRate(2)} disabled={isSubmittingReview}>
                    Hard
                  </button>
                  <button type="button" onClick={() => void handleRate(3)} disabled={isSubmittingReview}>
                    Good
                  </button>
                  <button type="button" onClick={() => void handleRate(4)} disabled={isSubmittingReview}>
                    Easy
                  </button>
                </div>
                {shortcutWarning ? <p className="error-text">{shortcutWarning}</p> : null}
              </div>

              {message ? <p className="small">{message}</p> : null}
              {error ? <p className="error-text">{error}</p> : null}
            </div>
          ) : null}
        </article>
      </section>
    </main>
  );
}
