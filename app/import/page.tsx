"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createDeckRecord } from "../../src/decks/store.ts";
import { createPracticeTestRecord } from "../../src/practice-tests/store.ts";
import type { Card, PracticeExam } from "../../src/api/types.ts";

type Status = "loading" | "success" | "error";

export default function ImportPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("Reading import data...");
  const [errorDetail, setErrorDetail] = useState("");

  useEffect(() => {
    try {
      const hash = window.location.hash.slice(1);
      if (!hash) {
        setStatus("error");
        setMessage("Nothing to import");
        setErrorDetail("The URL does not contain any import data. Make sure the link includes a # fragment with base64-encoded payload.");
        return;
      }

      let decoded: string;
      try {
        decoded = atob(hash);
      } catch {
        setStatus("error");
        setMessage("Invalid import data");
        setErrorDetail("The URL fragment could not be decoded. It must be valid base64.");
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(decoded) as Record<string, unknown>;
      } catch {
        setStatus("error");
        setMessage("Invalid import data");
        setErrorDetail("The decoded data is not valid JSON.");
        return;
      }

      if (!payload || typeof payload !== "object") {
        setStatus("error");
        setMessage("Invalid import data");
        setErrorDetail("Expected a JSON object with a \"type\" field.");
        return;
      }

      const { type } = payload;

      if (type === "deck") {
        const { title, courseId, courseName, resourceLabels, cards } = payload as {
          title: string;
          courseId: string;
          courseName: string;
          resourceLabels: string[];
          cards: Card[];
        };

        if (!courseId || !courseName || !Array.isArray(cards) || cards.length === 0) {
          setStatus("error");
          setMessage("Invalid deck data");
          setErrorDetail("A deck payload requires courseId, courseName, and a non-empty cards array.");
          return;
        }

        const deck = createDeckRecord({
          title: title || "",
          courseId,
          courseName,
          resourceLabels: Array.isArray(resourceLabels) ? resourceLabels : [],
          cards,
        });

        setStatus("success");
        setMessage(`Imported deck "${deck.title}" with ${deck.cardCount} cards`);
        router.push(`/decks?deckId=${encodeURIComponent(deck.deckId)}`);
      } else if (type === "practiceTest") {
        const { courseId, courseName, exam, title } = payload as {
          courseId: string;
          courseName: string;
          exam: PracticeExam;
          title?: string;
        };

        if (!courseId || !courseName || !exam || !Array.isArray(exam.questions) || exam.questions.length === 0) {
          setStatus("error");
          setMessage("Invalid practice test data");
          setErrorDetail("A practiceTest payload requires courseId, courseName, and an exam object with a non-empty questions array.");
          return;
        }

        const test = createPracticeTestRecord({
          courseId,
          courseName,
          exam,
          title: title || undefined,
        });

        setStatus("success");
        setMessage(`Imported practice test "${test.title}" with ${test.questionCount} questions`);
        router.push("/practice-tests");
      } else {
        setStatus("error");
        setMessage("Unknown import type");
        setErrorDetail(
          `Expected payload.type to be "deck" or "practiceTest", but got "${String(type ?? "(missing)")}".`
        );
      }
    } catch (err) {
      setStatus("error");
      setMessage("Import failed");
      setErrorDetail(err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  }, [router]);

  return (
    <main className="page import-modern" style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          textAlign: "center",
        }}
      >
        <div
          className="panel"
          style={{
            padding: "2rem 1.5rem",
            display: "grid",
            gap: "1rem",
            justifyItems: "center",
          }}
        >
          {status === "loading" && (
            <>
              <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Importing...</h2>
              <p className="small" style={{ margin: 0 }}>{message}</p>
            </>
          )}

          {status === "success" && (
            <>
              <h2 style={{ margin: 0, fontSize: "1.15rem", color: "var(--ok)" }}>
                Import Successful
              </h2>
              <p className="small" style={{ margin: 0 }}>{message}</p>
              <p className="small" style={{ margin: 0 }}>Redirecting...</p>
            </>
          )}

          {status === "error" && (
            <>
              <h2 style={{ margin: 0, fontSize: "1.15rem", color: "var(--error)" }}>
                {message}
              </h2>
              {errorDetail && (
                <p className="small" style={{ margin: 0, textAlign: "left", width: "100%" }}>
                  {errorDetail}
                </p>
              )}
              <Link
                href="/"
                className="button-link"
                style={{ marginTop: "0.5rem" }}
              >
                Back to Home
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
