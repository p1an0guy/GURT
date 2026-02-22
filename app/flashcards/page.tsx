"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";

import { createApiClient } from "../../src/api/client.ts";
import type {
  Course,
  CourseMaterial,
  IngestStatusResponse,
  UploadRequest,
  UploadResponse,
} from "../../src/api/types.ts";
import {
  createDeckRecord,
  listRecentDecks,
  resolveCourseName,
  type DeckSummary,
} from "../../src/decks/store.ts";
import {
  appendUniqueUploadFiles,
  getFlashcardSourceKind,
  getUploadQueueKey,
  getSelectedFlashcardSources,
  getUploadContentTypeForFile,
  type UploadQueueItem,
} from "../../src/flashcards/sources.ts";
import { getDefaultRuntimeSettings } from "../../src/runtime-settings.ts";

const NOTE_UPLOAD_ACCEPT_LABEL = "PDF, TXT, PPTX, DOCX, DOC";
const DROPZONE_ACCEPT: Record<UploadRequest["contentType"], string[]> = {
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/msword": [".doc"],
};
const INGEST_POLL_MAX_ATTEMPTS = 30;
const INGEST_POLL_WAIT_MS = 1500;
const MAX_SELECTED_MATERIALS = 10;
const MAX_FAILURE_DETAILS = 3;

interface LoadMaterialsOptions {
  preserveSelection?: boolean;
  autoSelectMaterialIds?: string[];
}

interface UploadFailure {
  filename: string;
  error: string;
}

interface UploadWarning {
  filename: string;
  warning: string;
}

interface BatchUploadSummary {
  successes: number;
  warnings: UploadWarning[];
  failures: UploadFailure[];
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

function buildApiUrl(baseUrl: string, path: string): string {
  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(baseUrl);

  if (hasScheme) {
    const absoluteBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    return new URL(normalizedPath, absoluteBase).toString();
  }

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!normalizedBase) {
    return normalizedPath;
  }

  return `${normalizedBase}${normalizedPath}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function getResponseError(response: Response): Promise<string> {
  const responseBody = await response.text();
  const statusPrefix = `${response.status} ${response.statusText}`.trim();
  if (!responseBody) {
    return `Request failed (${statusPrefix}).`;
  }
  return `Request failed (${statusPrefix}): ${responseBody}`;
}

export default function FlashcardsPage() {
  const [settings] = useState(getDefaultRuntimeSettings);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
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
  const [isCourseMenuOpen, setIsCourseMenuOpen] = useState(false);

  // Material selection state
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());
  const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);
  const [materialsLoaded, setMaterialsLoaded] = useState(false);
  const [materialsError, setMaterialsError] = useState("");

  // Upload + ingest state
  const [queuedUploadFiles, setQueuedUploadFiles] = useState<UploadQueueItem<File>[]>([]);
  const [uploadQueueMessage, setUploadQueueMessage] = useState("");
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadSummary, setUploadSummary] = useState<BatchUploadSummary | null>(null);
  const courseMenuRef = useRef<HTMLDivElement | null>(null);

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: settings.baseUrl,
        useFixtures: settings.useFixtures,
      }),
    [settings.baseUrl, settings.useFixtures],
  );

  const selectedSources = useMemo(
    () => getSelectedFlashcardSources(materials, selectedMaterialIds),
    [materials, selectedMaterialIds],
  );
  const selectedSyncedCount = selectedSources.filter((source) => source.kind === "synced").length;
  const selectedNoteCount = selectedSources.filter((source) => source.kind === "note").length;

  useEffect(() => {
    setRecentDecks(listRecentDecks());
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent): void {
      if (
        courseMenuRef.current &&
        !courseMenuRef.current.contains(event.target as Node)
      ) {
        setIsCourseMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsCourseMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  async function loadCourses(): Promise<void> {
    setIsLoadingCourses(true);
    setCourseLoadError("");
    try {
      const allCourses = await client.listCourses();
      setCourses(allCourses);
      setCoursesLoaded(true);
      if (allCourses.length > 0 && !allCourses.some((course) => course.id === courseId)) {
        setCourseId(allCourses[0].id);
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

  const loadMaterials = useCallback(
    async (
      forCourseId: string,
      options: LoadMaterialsOptions = {},
    ): Promise<void> => {
      setIsLoadingMaterials(true);
      setMaterialsError("");
      setMaterialsLoaded(false);

      if (!options.preserveSelection) {
        setSelectedMaterialIds(new Set());
      }

      try {
        const rows = await client.listCourseMaterials(forCourseId);
        setMaterials(rows);
        setMaterialsLoaded(true);

        setSelectedMaterialIds((previous) => {
          const allowed = new Set(rows.map((material) => material.canvasFileId));
          const next = options.preserveSelection
            ? new Set(Array.from(previous).filter((materialId) => allowed.has(materialId)))
            : new Set<string>();

          const autoSelectMaterialIds = options.autoSelectMaterialIds ?? [];
          for (const autoSelectId of autoSelectMaterialIds) {
            if (!allowed.has(autoSelectId)) {
              continue;
            }
            if (next.size < MAX_SELECTED_MATERIALS || next.has(autoSelectId)) {
              next.add(autoSelectId);
            }
          }

          return next;
        });
      } catch (loadError) {
        setMaterialsError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load course materials.",
        );
      } finally {
        setIsLoadingMaterials(false);
      }
    },
    [client],
  );

  useEffect(() => {
    void loadCourses();
  }, [client]);

  useEffect(() => {
    if (coursesLoaded && courseId) {
      void loadMaterials(courseId);
    }
  }, [coursesLoaded, courseId, loadMaterials]);

  function handleCourseChange(newCourseId: string): void {
    setCourseId(newCourseId);
    setIsCourseMenuOpen(false);
    setMessage("");
    setError("");
    setUploadQueueMessage("");
    setUploadError("");
    setUploadProgress("");
    setUploadSummary(null);
    setQueuedUploadFiles([]);
  }

  function toggleMaterial(fileId: string): void {
    setSelectedMaterialIds((previous) => {
      const next = new Set(previous);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else if (next.size < MAX_SELECTED_MATERIALS) {
        next.add(fileId);
      }
      return next;
    });
  }

  function toggleAllMaterials(): void {
    if (materials.length === 0) {
      return;
    }

    if (selectedMaterialIds.size === materials.length) {
      setSelectedMaterialIds(new Set());
    } else {
      setSelectedMaterialIds(
        new Set(
          materials
            .slice(0, MAX_SELECTED_MATERIALS)
            .map((material) => material.canvasFileId),
        ),
      );
    }
  }

  const handleDrop = useCallback((acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
    setUploadError("");
    setUploadSummary(null);

    const dedupeResult = appendUniqueUploadFiles(queuedUploadFiles, acceptedFiles);
    setQueuedUploadFiles(dedupeResult.queue);

    const unsupportedNames = rejectedFiles
      .filter((rejection) => rejection.errors.some((entry) => entry.code === "file-invalid-type"))
      .map((rejection) => rejection.file.name);

    const messages: string[] = [];
    if (dedupeResult.addedCount > 0) {
      messages.push(`Queued ${dedupeResult.addedCount} file${dedupeResult.addedCount === 1 ? "" : "s"}.`);
    }
    if (dedupeResult.duplicateCount > 0) {
      messages.push(
        `Skipped ${dedupeResult.duplicateCount} duplicate file${dedupeResult.duplicateCount === 1 ? "" : "s"} already in queue.`,
      );
    }
    if (unsupportedNames.length > 0) {
      messages.push(
        `Unsupported type skipped (${unsupportedNames.slice(0, 3).join(", ")}${unsupportedNames.length > 3 ? ` +${unsupportedNames.length - 3} more` : ""}). Use ${NOTE_UPLOAD_ACCEPT_LABEL}.`,
      );
    }

    setUploadQueueMessage(messages.join(" "));
  }, [queuedUploadFiles]);

  const isDropzoneDisabled = isUploadingFiles || !coursesLoaded || !courseId;
  const {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragReject,
  } = useDropzone({
    onDrop: handleDrop,
    multiple: true,
    disabled: isDropzoneDisabled,
    accept: DROPZONE_ACCEPT,
  });

  const createUploadMetadata = useCallback(
    async (request: UploadRequest): Promise<UploadResponse> => {
      if (settings.useFixtures) {
        const randomPart = Math.random().toString(36).slice(2, 10);
        const docId = `doc-${Date.now().toString(36)}-${randomPart}`;
        return {
          docId,
          key: `uploads/${request.courseId}/${docId}/${request.filename}`,
          uploadUrl: "https://fixture-upload.invalid",
          expiresInSeconds: 300,
          contentType: request.contentType,
        };
      }

      const response = await fetch(buildApiUrl(settings.baseUrl, "/uploads"), {
        method: "POST",
        headers: {
          "content-type": "text/plain",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(await getResponseError(response));
      }

      return (await response.json()) as UploadResponse;
    },
    [settings.baseUrl, settings.useFixtures],
  );

  const uploadFileToUrl = useCallback(
    async (
      uploadUrl: string,
      file: Blob,
      contentType: UploadRequest["contentType"],
    ): Promise<void> => {
      if (settings.useFixtures) {
        return;
      }

      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "content-type": contentType,
        },
        body: file,
      });

      if (!response.ok) {
        throw new Error(await getResponseError(response));
      }
    },
    [settings.useFixtures],
  );

  const pollIngestJob = useCallback(
    async (jobId: string): Promise<IngestStatusResponse> => {
      for (let attempt = 0; attempt < INGEST_POLL_MAX_ATTEMPTS; attempt += 1) {
        const ingestStatus = await client.getDocsIngestStatus(jobId);

        if (ingestStatus.status !== "RUNNING") {
          return ingestStatus;
        }

        await waitMs(INGEST_POLL_WAIT_MS);
      }

      throw new Error("Document ingest timed out. Try again.");
    },
    [client],
  );

  function removeQueuedFile(queueKey: string): void {
    setQueuedUploadFiles((previous) => previous.filter((queued) => queued.key !== queueKey));
    setUploadQueueMessage("");
    setUploadSummary(null);
    setUploadError("");
  }

  function clearQueuedFiles(): void {
    setQueuedUploadFiles([]);
    setUploadQueueMessage("");
    setUploadSummary(null);
    setUploadError("");
  }

  async function handleUploadQueuedFiles(): Promise<void> {
    setUploadQueueMessage("");
    setUploadSummary(null);
    setUploadError("");

    if (!courseId) {
      setUploadError("Select a course before uploading notes.");
      return;
    }

    if (queuedUploadFiles.length === 0) {
      setUploadError("Add files to the queue before uploading.");
      return;
    }

    setIsUploadingFiles(true);
    setUploadProgress("");

    const filesToProcess = [...queuedUploadFiles];
    const failures: UploadFailure[] = [];
    const warnings: UploadWarning[] = [];
    const successfulMaterialIds: string[] = [];
    let successes = 0;

    try {
      for (let index = 0; index < filesToProcess.length; index += 1) {
        const queued = filesToProcess[index];
        const currentFile = queued.file;
        setUploadProgress(`Processing ${index + 1}/${filesToProcess.length}: ${currentFile.name}`);

        const uploadContentType = getUploadContentTypeForFile(currentFile);
        if (!uploadContentType) {
          failures.push({
            filename: currentFile.name,
            error: `Unsupported file type. Use ${NOTE_UPLOAD_ACCEPT_LABEL}.`,
          });
          continue;
        }

        try {
          const upload = await createUploadMetadata({
            courseId,
            filename: currentFile.name,
            contentType: uploadContentType,
            ...(currentFile.size > 0
              ? { contentLengthBytes: currentFile.size }
              : {}),
          });

          await uploadFileToUrl(upload.uploadUrl, currentFile, upload.contentType);

          const ingestStart = await client.startDocsIngest({
            docId: upload.docId,
            courseId,
            key: upload.key,
          });

          const ingestStatus = await pollIngestJob(ingestStart.jobId);
          if (ingestStatus.status === "FAILED") {
            throw new Error(ingestStatus.error || "Document ingest failed.");
          }

          successes += 1;
          successfulMaterialIds.push(upload.docId);

          if (ingestStatus.kbIngestionError && ingestStatus.kbIngestionError.trim()) {
            warnings.push({
              filename: currentFile.name,
              warning: ingestStatus.kbIngestionError,
            });
          }
        } catch (fileFailure) {
          failures.push({
            filename: currentFile.name,
            error: getErrorMessage(fileFailure, "Could not upload and ingest file."),
          });
        }
      }

      if (successfulMaterialIds.length > 0) {
        await loadMaterials(courseId, {
          preserveSelection: true,
          autoSelectMaterialIds: successfulMaterialIds,
        });
      }

      setQueuedUploadFiles([]);
      setUploadSummary({
        successes,
        warnings,
        failures,
      });
    } finally {
      setUploadProgress("");
      setIsUploadingFiles(false);
    }
  }

  async function handleGenerateDeck(): Promise<void> {
    setMessage("");
    setError("");
    setIsGenerating(true);

    try {
      const requested = Number.parseInt(numCards, 10);
      const count = Number.isNaN(requested) ? 12 : requested;
      const materialIds = selectedSources.map((source) => source.materialId);

      const cards = await client.generateFlashcardsFromMaterials(
        courseId,
        materialIds,
        count,
      );

      const deck = createDeckRecord({
        title: deckTitle,
        courseId,
        courseName: resolveCourseName(courses, courseId),
        resourceLabels: selectedSources.map((source) => source.displayName),
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
    selectedSources.length > 0 &&
    !isGenerating &&
    !isLoadingMaterials &&
    !isUploadingFiles;

  const selectedCourseName =
    courses.find((course) => course.id === courseId)?.name ?? "No course selected";
  const selectedCourse =
    courses.find((course) => course.id === courseId) ?? null;
  const selectedCourseLabel = selectedCourse
    ? `${selectedCourse.name} (${selectedCourse.term})`
    : "Select a course";

  return (
    <main className="page flashcards-modern">
      <section className="hero flashcards-modern-hero">
        <div className="flashcards-hero-content">
          <p className="flashcards-kicker">Study Lab</p>
          <h1>Flashcards</h1>
          <p>
            Build targeted decks from synced course materials and your own uploaded
            notes, then jump straight into review.
          </p>
          <div className="flashcards-hero-meta">
            <span className="flashcards-chip">
              <strong>{selectedSources.length}</strong> selected
            </span>
            <span className="flashcards-chip">
              <strong>{selectedSyncedCount}</strong> synced
            </span>
            <span className="flashcards-chip">
              <strong>{selectedNoteCount}</strong> notes
            </span>
            <span className="flashcards-chip">
              <strong>{numCards || "12"}</strong> target cards
            </span>
            <span className="flashcards-chip flashcards-chip-course" title={selectedCourseName}>
              {selectedCourseName}
            </span>
          </div>
        </div>
      </section>

      <section className="panel-grid flashcards-modern-grid">
        <article className="panel flashcards-generate-panel">
          <div className="flashcards-panel-head">
            <h2>Generate New Deck</h2>
          </div>
          <div className="controls flashcards-modern-controls">
            <label htmlFor="courseSelect">Course</label>
            {coursesLoaded && courses.length > 0 ? (
              <div className="flashcards-course-select-wrap" ref={courseMenuRef}>
                <button
                  id="courseSelect"
                  type="button"
                  className={`flashcards-course-trigger${isCourseMenuOpen ? " is-open" : ""}`}
                  onClick={() => setIsCourseMenuOpen((open) => !open)}
                  aria-haspopup="listbox"
                  aria-expanded={isCourseMenuOpen}
                  aria-controls="courseSelectListbox"
                >
                  <span className="flashcards-course-select-text">{selectedCourseLabel}</span>
                </button>

                {isCourseMenuOpen ? (
                  <ul
                    id="courseSelectListbox"
                    className="flashcards-course-menu"
                    role="listbox"
                    aria-label="Course options"
                  >
                    {courses.map((course) => {
                      const isSelected = course.id === courseId;
                      return (
                        <li key={course.id} role="none">
                          <button
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`flashcards-course-option${isSelected ? " is-selected" : ""}`}
                            onClick={() => handleCourseChange(course.id)}
                          >
                            <span className="flashcards-course-option-name">
                              {course.name}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : isLoadingCourses || !hasAttemptedCourseLoad ? (
              <div className="status-block">
                <p className="small">Loading courses...</p>
              </div>
            ) : coursesLoaded && courses.length === 0 ? (
              <div className="status-block">
                <p className="small">No courses found. Sync Canvas to load your courses.</p>
                <p className="small">
                  Need diagnostics? <Link href="/dev-tools">Open dev tools</Link>.
                </p>
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

            {coursesLoaded ? (
              <>
                <label>Upload New Notes</label>
                <div
                  {...getRootProps({
                    className: [
                      "flashcards-upload-dropzone",
                      isDragActive ? "is-active" : "",
                      isDragReject ? "is-reject" : "",
                      isDropzoneDisabled ? "is-disabled" : "",
                      uploadError ? "has-error" : "",
                    ]
                      .filter(Boolean)
                      .join(" "),
                  })}
                >
                  <input {...getInputProps()} />
                  <p className="flashcards-upload-dropzone-title">
                    {isDragActive
                      ? "Drop files to queue upload"
                      : "Drag files here, or click to choose"}
                  </p>
                  <p className="small flashcards-upload-dropzone-meta">
                    Supports {NOTE_UPLOAD_ACCEPT_LABEL}.
                  </p>
                  {isDropzoneDisabled ? (
                    <p className="small flashcards-upload-dropzone-meta">
                      {isUploadingFiles
                        ? "Upload in progress..."
                        : "Select a course to enable uploads."}
                    </p>
                  ) : null}
                </div>

                {queuedUploadFiles.length > 0 ? (
                  <div className="flashcards-upload-queue">
                    <div className="flashcards-upload-queue-header">
                      <span className="small">
                        {queuedUploadFiles.length} queued file
                        {queuedUploadFiles.length === 1 ? "" : "s"}
                      </span>
                      <button
                        type="button"
                        className="secondary-button flashcards-upload-clear"
                        onClick={clearQueuedFiles}
                        disabled={isUploadingFiles}
                      >
                        Clear Queue
                      </button>
                    </div>
                    <ul className="flashcards-upload-chip-list">
                      {queuedUploadFiles.map((queued) => (
                        <li key={queued.key} className="flashcards-upload-chip">
                          <span className="flashcards-upload-chip-name" title={queued.file.name}>
                            {queued.file.name}
                          </span>
                          <span className="flashcards-upload-chip-size small">
                            {formatFileSize(queued.file.size)}
                          </span>
                          <button
                            type="button"
                            className="flashcards-upload-chip-remove"
                            onClick={() => removeQueuedFile(getUploadQueueKey(queued.file))}
                            disabled={isUploadingFiles}
                            aria-label={`Remove ${queued.file.name}`}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="flashcards-upload-actions">
                  <button
                    type="button"
                    onClick={() => void handleUploadQueuedFiles()}
                    disabled={
                      isUploadingFiles ||
                      queuedUploadFiles.length === 0 ||
                      !courseId ||
                      !coursesLoaded
                    }
                  >
                    {isUploadingFiles
                      ? "Uploading..."
                      : "Upload Files"}
                  </button>
                </div>

                {uploadProgress ? (
                  <p className="small flashcards-upload-progress">{uploadProgress}</p>
                ) : null}
                {uploadQueueMessage ? (
                  <p className="small flashcards-upload-queue-message">{uploadQueueMessage}</p>
                ) : null}
                {uploadError ? (
                  <p className="error-text flashcards-upload-error">{uploadError}</p>
                ) : null}

                {uploadSummary ? (
                  <div className="status-block flashcards-upload-summary">
                    <p className="small flashcards-feedback success">
                      Batch complete: {uploadSummary.successes} success
                      {uploadSummary.successes === 1 ? "" : "es"}, {uploadSummary.warnings.length} warning
                      {uploadSummary.warnings.length === 1 ? "" : "s"}, {uploadSummary.failures.length} failure
                      {uploadSummary.failures.length === 1 ? "" : "s"}.
                    </p>

                    {uploadSummary.warnings.length > 0 ? (
                      <div className="flashcards-upload-warning-list">
                        <p className="warning-text">
                          Some files were ingested, but KB indexing did not trigger. RAG freshness may lag.
                        </p>
                        <ul className="list flashcards-upload-result-list">
                          {uploadSummary.warnings.map((warning) => (
                            <li key={`warn-${warning.filename}`}>
                              <span className="mono">{warning.filename}</span>: {warning.warning}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {uploadSummary.failures.length > 0 ? (
                      <div className="flashcards-upload-failure-list">
                        <p className="small">Failed files:</p>
                        <ul className="list flashcards-upload-result-list">
                          {uploadSummary.failures
                            .slice(0, MAX_FAILURE_DETAILS)
                            .map((failure) => (
                              <li key={`fail-${failure.filename}`}>
                                <span className="mono">{failure.filename}</span>: {failure.error}
                              </li>
                            ))}
                        </ul>
                        {uploadSummary.failures.length > MAX_FAILURE_DETAILS ? (
                          <p className="small">
                            +{uploadSummary.failures.length - MAX_FAILURE_DETAILS} more failure
                            {uploadSummary.failures.length - MAX_FAILURE_DETAILS === 1
                              ? ""
                              : "s"}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}

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
                      No materials yet for this course.</p>
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
                    {materials.map((material) => {
                      const sourceKind = getFlashcardSourceKind(material);
                      return (
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
                              selectedMaterialIds.size >= MAX_SELECTED_MATERIALS
                            }
                          />
                          <span className="material-name">{material.displayName}</span>
                          {sourceKind === "note" ? (
                            <span className="tag flashcards-note-tag">NOTE</span>
                          ) : null}
                          <span className="tag">{fileTypeLabel(material.contentType)}</span>
                          <span className="material-size small">
                            {formatFileSize(material.sizeBytes)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : null}

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
              className="flashcards-generate-button"
              onClick={() => void handleGenerateDeck()}
              disabled={!canGenerate}
            >
              {isGenerating
                ? "Generating..."
                : selectedSources.length === 0
                  ? "Generate Deck"
                  : `Generate Deck from ${selectedSources.length} material${selectedSources.length === 1 ? "" : "s"}`}
            </button>

            {message ? <p className="small flashcards-feedback success">{message}</p> : null}
            {error ? (
              <div className="status-block">
                <p className="small">
                  We could not generate your deck right now. Please try again.
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void handleGenerateDeck()}
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
          </div>
        </article>

        <article className="panel flashcards-recent-panel">
          <div className="flashcards-panel-head">
            <h2>Recent Decks</h2>
            <p className="small">Continue where you left off.</p>
          </div>
          {recentDecks.length === 0 ? (
            <p className="small flashcards-empty-state">
              No decks yet. Generate your first deck to get started.
            </p>
          ) : (
            <ul className="list flashcards-recent-list">
              {recentDecks.map((deck) => (
                <li key={deck.deckId} className="flashcards-recent-item">
                  <h3 className="flashcards-deck-title">{deck.title}</h3>
                  <div className="flashcards-deck-summary">
                    <span className="tag">{deck.courseName}</span>
                    <span className="flashcards-deck-count">{deck.cardCount} cards</span>
                  </div>
                  <div className="flashcards-deck-meta">
                    <p className="flashcards-meta-line">
                      <span className="flashcards-meta-label">Created</span>
                      <span className="flashcards-meta-value mono">{deck.createdAt}</span>
                    </p>
                    <p className="flashcards-meta-line">
                      <span className="flashcards-meta-label">Sources</span>
                      <span className="flashcards-meta-value">
                        {deck.resourceLabels.length > 0
                          ? deck.resourceLabels.join(", ")
                          : "none listed"}
                      </span>
                    </p>
                  </div>
                  <div className="deck-actions">
                    <Link
                      className="button-link"
                      href={`/decks?deckId=${encodeURIComponent(deck.deckId)}`}
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
