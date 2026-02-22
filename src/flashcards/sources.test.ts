import assert from "node:assert/strict";
import test from "node:test";

import type { CourseMaterial } from "../api/types.ts";
import {
  appendUniqueUploadFiles,
  getFlashcardSourceKind,
  getSelectedFlashcardSources,
  getUploadContentTypeForFile,
  getUploadQueueKey,
  splitFilesBySupportedUploadType,
} from "./sources.ts";

test("getUploadContentTypeForFile accepts browser-provided content type", () => {
  const contentType = getUploadContentTypeForFile({
    name: "notes.anything",
    type: "application/pdf",
  });

  assert.equal(contentType, "application/pdf");
});

test("getUploadContentTypeForFile falls back to extension when file.type is empty", () => {
  const contentType = getUploadContentTypeForFile({
    name: "week-3-outline.docx",
    type: "",
  });

  assert.equal(
    contentType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
});

test("getUploadContentTypeForFile rejects unsupported files", () => {
  const contentType = getUploadContentTypeForFile({
    name: "diagram.png",
    type: "image/png",
  });

  assert.equal(contentType, null);
});

test("splitFilesBySupportedUploadType classifies accepted and rejected files", () => {
  const files: Array<Pick<File, "name" | "type">> = [
    { name: "lecture-1.pdf", type: "application/pdf" },
    { name: "outline.DOCX", type: "" },
    { name: "summary.txt", type: "text/plain" },
    { name: "diagram.png", type: "image/png" },
  ];

  const { accepted, rejected } = splitFilesBySupportedUploadType(files);

  assert.deepEqual(accepted.map((file) => file.name), [
    "lecture-1.pdf",
    "outline.DOCX",
    "summary.txt",
  ]);
  assert.deepEqual(rejected.map((file) => file.name), ["diagram.png"]);
});

test("getUploadQueueKey uses name size and lastModified", () => {
  const key = getUploadQueueKey({
    name: "lecture.pdf",
    size: 1024,
    lastModified: 1700000000000,
  });

  assert.equal(key, "lecture.pdf::1024::1700000000000");
});

test("appendUniqueUploadFiles appends only unique files and reports counts", () => {
  const existing = [
    {
      key: getUploadQueueKey({
        name: "existing.pdf",
        size: 10,
        lastModified: 1,
      }),
      file: {
        name: "existing.pdf",
        size: 10,
        lastModified: 1,
        type: "application/pdf",
      },
    },
  ];

  const incoming: Array<Pick<File, "name" | "size" | "lastModified" | "type">> = [
    { name: "existing.pdf", size: 10, lastModified: 1, type: "application/pdf" },
    { name: "new.docx", size: 200, lastModified: 2, type: "" },
    { name: "new.docx", size: 200, lastModified: 2, type: "" },
    { name: "new-2.txt", size: 50, lastModified: 3, type: "text/plain" },
  ];

  const result = appendUniqueUploadFiles(existing, incoming);

  assert.equal(result.addedCount, 2);
  assert.equal(result.duplicateCount, 2);
  assert.deepEqual(result.queue.map((row) => row.file.name), [
    "existing.pdf",
    "new.docx",
    "new-2.txt",
  ]);
});

test("getFlashcardSourceKind distinguishes uploaded notes from synced materials", () => {
  assert.equal(getFlashcardSourceKind({ canvasFileId: "doc-abc123" }), "note");
  assert.equal(getFlashcardSourceKind({ canvasFileId: "file-98765" }), "synced");
});

test("getSelectedFlashcardSources returns selected sources with explicit kinds", () => {
  const materials: CourseMaterial[] = [
    {
      canvasFileId: "file-1",
      courseId: "course-1",
      displayName: "Lecture Slides.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      canvasFileId: "doc-1",
      courseId: "course-1",
      displayName: "Week 2 Notes.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 100,
      updatedAt: "2026-01-02T00:00:00Z",
    },
  ];

  const selected = getSelectedFlashcardSources(materials, new Set(["doc-1", "file-1"]));

  assert.deepEqual(selected, [
    {
      materialId: "file-1",
      displayName: "Lecture Slides.pdf",
      kind: "synced",
    },
    {
      materialId: "doc-1",
      displayName: "Week 2 Notes.docx",
      kind: "note",
    },
  ]);
});
