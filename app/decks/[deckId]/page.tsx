"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { createApiClient } from "../../../src/api/client.ts";
import { getDeckById, markDeckStudied, type DeckRecord } from "../../../src/decks/store.ts";
import { readRuntimeSettings } from "../../../src/runtime-settings.ts";

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export default function DeckStudyPage() {
  const params = useParams<{ deckId: string }>();
  const deckId = typeof params.deckId === "string" ? params.deckId : "";
  const [deck, setDeck] = useState<DeckRecord | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const settings = useMemo(readRuntimeSettings, []);
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

  async function handleRate(rating: 1 | 2 | 3 | 4 | 5): Promise<void> {
    if (!deck || !activeCard) {
      return;
    }

    setError("");
    setMessage("");
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
      setMessage(`Saved rating ${rating}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to submit review");
    }
  }

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
              <div className="status-block">
                <p>
                  <strong>Prompt</strong>
                </p>
                <p>{activeCard.prompt}</p>
              </div>

              {revealed ? (
                <div className="status-block">
                  <p>
                    <strong>Answer</strong>
                  </p>
                  <p>{activeCard.answer}</p>
                </div>
              ) : null}

              <button type="button" onClick={() => setRevealed((prev) => !prev)}>
                {revealed ? "Hide Answer" : "Reveal Answer"}
              </button>

              <p className="small">Rate recall quality:</p>
              <div className="rating-row">
                <button type="button" onClick={() => void handleRate(1)}>
                  1
                </button>
                <button type="button" onClick={() => void handleRate(2)}>
                  2
                </button>
                <button type="button" onClick={() => void handleRate(3)}>
                  3
                </button>
                <button type="button" onClick={() => void handleRate(4)}>
                  4
                </button>
                <button type="button" onClick={() => void handleRate(5)}>
                  5
                </button>
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
