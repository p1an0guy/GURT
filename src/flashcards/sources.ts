import type { CourseMaterial, UploadRequest } from "../api/types.ts";

export const SUPPORTED_NOTE_CONTENT_TYPES: readonly UploadRequest["contentType"][] = [
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

const CONTENT_TYPE_SET = new Set<UploadRequest["contentType"]>(SUPPORTED_NOTE_CONTENT_TYPES);
const EXTENSION_TO_CONTENT_TYPE: Record<string, UploadRequest["contentType"]> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
};

export type FlashcardSourceKind = "synced" | "note";

export interface SelectedFlashcardSource {
  materialId: string;
  displayName: string;
  kind: FlashcardSourceKind;
}

export interface UploadQueueItem<TFile extends Pick<File, "name" | "size" | "lastModified"> = File> {
  key: string;
  file: TFile;
}

export function getUploadContentTypeForFile(
  file: Pick<File, "name" | "type">,
): UploadRequest["contentType"] | null {
  if (CONTENT_TYPE_SET.has(file.type as UploadRequest["contentType"])) {
    return file.type as UploadRequest["contentType"];
  }

  const lowerName = file.name.toLowerCase();
  for (const [extension, contentType] of Object.entries(EXTENSION_TO_CONTENT_TYPE)) {
    if (lowerName.endsWith(extension)) {
      return contentType;
    }
  }

  return null;
}

export function splitFilesBySupportedUploadType<TFile extends Pick<File, "name" | "type">>(
  files: readonly TFile[],
): { accepted: TFile[]; rejected: TFile[] } {
  const accepted: TFile[] = [];
  const rejected: TFile[] = [];

  for (const file of files) {
    if (getUploadContentTypeForFile(file)) {
      accepted.push(file);
      continue;
    }
    rejected.push(file);
  }

  return { accepted, rejected };
}

export function getUploadQueueKey(file: Pick<File, "name" | "size" | "lastModified">): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

export function appendUniqueUploadFiles<TFile extends Pick<File, "name" | "size" | "lastModified">>(
  previous: readonly UploadQueueItem<TFile>[],
  incoming: readonly TFile[],
): { queue: UploadQueueItem<TFile>[]; addedCount: number; duplicateCount: number } {
  const seenKeys = new Set(previous.map((queued) => queued.key));
  const queue = [...previous];
  let addedCount = 0;
  let duplicateCount = 0;

  for (const file of incoming) {
    const key = getUploadQueueKey(file);
    if (seenKeys.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seenKeys.add(key);
    queue.push({ key, file });
    addedCount += 1;
  }

  return { queue, addedCount, duplicateCount };
}

export function getFlashcardSourceKind(
  material: Pick<CourseMaterial, "canvasFileId">,
): FlashcardSourceKind {
  return material.canvasFileId.startsWith("doc-") ? "note" : "synced";
}

export function getSelectedFlashcardSources(
  materials: readonly CourseMaterial[],
  selectedMaterialIds: ReadonlySet<string>,
): SelectedFlashcardSource[] {
  return materials
    .filter((material) => selectedMaterialIds.has(material.canvasFileId))
    .map((material) => ({
      materialId: material.canvasFileId,
      displayName: material.displayName,
      kind: getFlashcardSourceKind(material),
    }));
}
