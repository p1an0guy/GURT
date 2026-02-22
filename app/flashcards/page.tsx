"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createApiClient } from "../../src/api/client.ts";
import {
  createDeckRecord,
  listRecentDecks,
  resolveCourseName,
  type DeckSummary,
} from "../../src/decks/store.ts";
import { getDefaultRuntimeSettings } from "../../src/runtime-settings.ts";
import type { Course, CourseMaterial } from "../../src/api/types.ts";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeLabel(contentType: string): string {
  if (contentType.includes("pdf")) return "PDF";
  if (contentType.includes("text")) return "TXT";
  if (contentType.includes("word") || contentType.includes("document")) return "DOC";
  if (contentType.includes("presentation") || contentType.includes("powerpoint")) return "PPT";
  return contentType.split("/").pop()?.toUpperCase() ?? "FILE";
}

export default function FlashcardsPage() {
  const [settings] = useState(getDefaultRuntimeSettings);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("course-psych-101");
  const [deckTitle, setDeckTitle] = useState("");
  const [numCards, setNumCards] = useState("12");
  const [recentDecks, setRecentDecks] = useState<DeckSummary[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [hasAttemptedCourseLoad, setHasAttemptedCourseLoad] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [courseLoadError, setCourseLoadError] = useState("");

  // Material selection state
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());
  const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);
  const [materialsLoaded, setMaterialsLoaded] = useState(false);
  const [materialsError, setMaterialsError] = useState("");

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: settings.baseUrl,
        useFixtures: settings.useFixtures,
      }),
    [settings.baseUrl, settings.useFixtures],
  );

  useEffect(() => {
    setRecentDecks(listRecentDecks());
  }, []);

  async function loadCourses(): Promise<void> {
    setIsLoadingCourses(true);
    setCourseLoadError("");
    try {
      const rows = await client.listCourses();
      setCourses(rows);
      setCoursesLoaded(true);
      if (!rows.some((row) => row.id === courseId) && rows.length > 0) {
        setCourseId(rows[0].id);
      }
    } catch (loadError) {
      setCoursesLoaded(false);
      setCourseLoadError(
        loadError instanceof Error
          ? loadError.message
          : "We could not load your courses right now.",
      );
    } finally {
      setIsLoadingCourses(false);
      setHasAttemptedCourseLoad(true);
    }
  }

  const loadMaterials = useCallback(async (forCourseId: string): Promise<void> => {
    setIsLoadingMaterials(true);
    setMaterialsError("");
    setMaterials([]);
    setSelectedMaterialIds(new Set());
    setMaterialsLoaded(false);
    try {
      const rows = await client.listCourseMaterials(forCourseId);
      setMaterials(rows);
      setMaterialsLoaded(true);
    } catch (loadError) {
      setMaterialsError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load course materials.",
      );
    } finally {
      setIsLoadingMaterials(false);
    }
  }, [client]);

  useEffect(() => {
    void loadCourses();
  }, [client]);

  // Load materials when course changes and courses are loaded
  useEffect(() => {
    if (coursesLoaded && courseId) {
      void loadMaterials(courseId);
    }
  }, [coursesLoaded, courseId, loadMaterials]);

  function handleCourseChange(newCourseId: string): void {
    setCourseId(newCourseId);
    setMessage("");
    setError("");
  }

  function toggleMaterial(fileId: string): void {
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else if (next.size < 10) {
        next.add(fileId);
      }
      return next;
    });
  }

  function toggleAllMaterials(): void {
    if (selectedMaterialIds.size === materials.length) {
      setSelectedMaterialIds(new Set());
    } else {
      setSelectedMaterialIds(new Set(materials.slice(0, 10).map((m) => m.canvasFileId)));
    }
  }

  async function handleGenerateDeck(): Promise<void> {
    setMessage("");
    setError("");
    setIsGenerating(true);

    try {
      const requested = Number.parseInt(numCards, 10);
      const count = Number.isNaN(requested) ? 12 : requested;
      const materialIds = Array.from(selectedMaterialIds);

      const cards = await client.generateFlashcardsFromMaterials(
        courseId,
        materialIds,
        count,
      );

      const selectedNames = materials
        .filter((m) => selectedMaterialIds.has(m.canvasFileId))
        .map((m) => m.displayName);

      const deck = createDeckRecord({
        title: deckTitle,
        courseId,
        courseName: resolveCourseName(courses, courseId),
        resourceLabels: selectedNames,
        cards,
      });
      setRecentDecks(listRecentDecks());
      setMessage(`Created deck "${deck.title}" with ${deck.cardCount} flashcards.`);
      if (!deckTitle.trim()) {
        setDeckTitle("");
      }
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Failed to generate deck",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  const canGenerate =
    coursesLoaded &&
    materialsLoaded &&
    selectedMaterialIds.size > 0 &&
    !isGenerating &&
    !isLoadingMaterials;

  return (
    <main className="page">
      <section className="hero">
        <h1>Flashcards</h1>
        <p>Select course materials and generate focused flashcard decks with AI.</p>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <h2>Generate New Deck</h2>
          <div className="controls">
            {/* Step 1: Course selection */}
            <label htmlFor="courseSelect">Course</label>
            {coursesLoaded ? (
              <select
                id="courseSelect"
                value={courseId}
                onChange={(event) => handleCourseChange(event.target.value)}
              >
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name} ({course.term})
                  </option>
                ))}
              </select>
            ) : isLoadingCourses || !hasAttemptedCourseLoad ? (
              <div className="status-block">
                <p className="small">Loading courses...</p>
              </div>
            ) : (
              <div className="status-block">
                <p className="small">We could not load your courses right now.</p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void loadCourses()}
                  disabled={isLoadingCourses}
                >
                  {isLoadingCourses ? "Retrying..." : "Try Again"}
                </button>
                <p className="small">
                  Need diagnostics? <Link href="/dev-tools">Open dev tools</Link>.
                </p>
                {courseLoadError ? <p className="small mono">{courseLoadError}</p> : null}
              </div>
            )}

            {/* Step 2: Material selection */}
            {coursesLoaded ? (
              <>
                <label>Source Materials</label>
                {isLoadingMaterials ? (
                  <div className="status-block">
                    <p className="small">Loading materials...</p>
                  </div>
                ) : materialsError ? (
                  <div className="status-block">
                    <p className="small">Could not load materials.</p>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void loadMaterials(courseId)}
                      disabled={isLoadingMaterials}
                    >
                      Try Again
                    </button>
                    <p className="small mono">{materialsError}</p>
                  </div>
                ) : materialsLoaded && materials.length === 0 ? (
                  <div className="status-block">
                    <p className="small">
                      No synced materials for this course. Sync your Canvas data first
                      from <Link href="/dev-tools">dev tools</Link>.
                    </p>
                  </div>
                ) : materialsLoaded ? (
                  <div className="material-list">
                    <div className="material-list-header">
                      <button
                        type="button"
                        className="material-toggle-all"
                        onClick={toggleAllMaterials}
                      >
                        {selectedMaterialIds.size === materials.length
                          ? "Deselect All"
                          : "Select All"}
                      </button>
                      <span className="small">
                        {selectedMaterialIds.size} of {materials.length} selected
                      </span>
                    </div>
                    {materials.map((material) => (
                      <label
                        key={material.canvasFileId}
                        className={`material-row${selectedMaterialIds.has(material.canvasFileId) ? " selected" : ""}`}
                      >
                        <input
                          type="checkbox"
                          className="material-checkbox"
                          checked={selectedMaterialIds.has(material.canvasFileId)}
                          onChange={() => toggleMaterial(material.canvasFileId)}
                          disabled={
                            !selectedMaterialIds.has(material.canvasFileId) &&
                            selectedMaterialIds.size >= 10
                          }
                        />
                        <span className="material-name">{material.displayName}</span>
                        <span className="tag">{fileTypeLabel(material.contentType)}</span>
                        <span className="material-size small">
                          {formatFileSize(material.sizeBytes)}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}

            {/* Step 3: Configuration and generate */}
            <label htmlFor="deckTitle">Deck Title</label>
            <input
              id="deckTitle"
              value={deckTitle}
              onChange={(event) => setDeckTitle(event.target.value)}
              placeholder="Week 4 Memory Models"
            />

            <label htmlFor="numCards">Number of Cards</label>
            <input
              id="numCards"
              value={numCards}
              onChange={(event) => setNumCards(event.target.value)}
              placeholder="12"
            />

            <button
              type="button"
              onClick={handleGenerateDeck}
              disabled={!canGenerate}
            >
              {isGenerating
                ? "Generating..."
                : selectedMaterialIds.size === 0
                  ? "Select materials to generate"
                  : `Generate Deck from ${selectedMaterialIds.size} material${selectedMaterialIds.size === 1 ? "" : "s"}`}
            </button>

            {message ? <p className="small">{message}</p> : null}
            {error ? (
              <div className="status-block">
                <p className="small">
                  We could not generate your deck right now. Please try again.
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleGenerateDeck}
                  disabled={!canGenerate}
                >
                  {isGenerating ? "Retrying..." : "Retry Generate Deck"}
                </button>
                <p className="small">
                  If this keeps happening, verify your environment setup in docs or use{" "}
                  <Link href="/dev-tools">dev tools</Link>.
                </p>
                <p className="small mono">{error}</p>
              </div>
            ) : null}

            <p className="small">
              Need raw API/debug actions? <Link href="/dev-tools">Open dev tools</Link>.
            </p>
          </div>
        </article>

        <article className="panel">
          <h2>Recent Decks</h2>
          {recentDecks.length === 0 ? (
            <p className="small">No decks yet. Generate your first deck to get started.</p>
          ) : (
            <ul className="list">
              {recentDecks.map((deck) => (
                <li key={deck.deckId}>
                  <strong>{deck.title}</strong>
                  <span className="tag">{deck.courseName}</span>
                  <div className="small">{deck.cardCount} cards</div>
                  <div className="small">Created {deck.createdAt}</div>
                  {deck.resourceLabels.length > 0 ? (
                    <div className="small">Sources: {deck.resourceLabels.join(", ")}</div>
                  ) : (
                    <div className="small">Sources: none listed</div>
                  )}
                  <div className="deck-actions">
                    <Link
                      className="button-link"
                      href={`/decks/${encodeURIComponent(deck.deckId)}`}
                    >
                      Study Deck
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </main>
  );
}
