import assert from "node:assert/strict";
import test from "node:test";

import {
  getFlashcardSourceKind,
  getSelectedFlashcardSources,
  getUploadContentTypeForFile,
} from "./sources.ts";
import type { CourseMaterial } from "../api/types.ts";

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

