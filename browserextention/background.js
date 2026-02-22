let canvasUploadLoadError = null;

function ensureCanvasUploadLoaded() {
  if (
    globalThis.CanvasUpload &&
    typeof globalThis.CanvasUpload.uploadAndIngestFile === "function" &&
    typeof globalThis.CanvasUpload.normalizeDiscoveredFiles === "function"
  ) {
    return globalThis.CanvasUpload;
  }

  const attempts = [];
  const candidates = ["canvas_upload.js", "/canvas_upload.js"];
  try {
    const runtimeUrl = chrome.runtime.getURL("canvas_upload.js");
    if (!candidates.includes(runtimeUrl)) {
      candidates.push(runtimeUrl);
    }
  } catch {
    // Ignore URL build errors and rely on relative/absolute candidates.
  }

  for (const candidate of candidates) {
    try {
      importScripts(candidate);
      if (
        globalThis.CanvasUpload &&
        typeof globalThis.CanvasUpload.uploadAndIngestFile === "function" &&
        typeof globalThis.CanvasUpload.normalizeDiscoveredFiles === "function"
      ) {
        canvasUploadLoadError = null;
        return globalThis.CanvasUpload;
      }
      attempts.push(`${candidate}: loaded but CanvasUpload API missing`);
    } catch (error) {
      attempts.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const details = attempts.length > 0 ? attempts.join(" | ") : "unknown error";
  const error = new Error(`Unable to load canvas_upload.js (${details})`);
  canvasUploadLoadError = error;
  throw error;
}

try {
  ensureCanvasUploadLoaded();
} catch (error) {
  // Keep worker alive and surface a clear error on scrape start instead of hard-crashing.
  console.error("[Gurt] Failed to preload canvas_upload.js", error);
}

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

const CHAT_API_URL = "https://hpthlfk5ql.execute-api.us-west-2.amazonaws.com/dev/chat";
const API_BASE_URL = CHAT_API_URL.replace(/\/chat\/?$/, "");
const WEBAPP_BASE_URL = "http://localhost:3000"; // TODO: update with CloudFront URL for production

let activeScrapeRun = null;

// --- Course change detection ---
// Notify side panel when the user navigates to a different Canvas course
function notifyCourseChange(tabId, url) {
  if (!url || !url.includes("canvas.calpoly.edu")) return;
  const match = url.match(/\/courses\/(\d+)/);
  if (!match) return;
  const courseId = match[1];
  // Try to get course name from content script
  chrome.tabs.sendMessage(tabId, { type: "GET_CONTEXT" }).then(ctx => {
    chrome.runtime.sendMessage({
      type: "COURSE_CHANGED",
      courseId,
      courseName: (ctx && ctx.courseName) || `Course ${courseId}`
    }).catch(() => { /* side panel not open */ });
  }).catch(() => {
    // Content script not ready, send without name
    chrome.runtime.sendMessage({
      type: "COURSE_CHANGED",
      courseId,
      courseName: `Course ${courseId}`
    }).catch(() => { /* side panel not open */ });
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    notifyCourseChange(tabId, changeInfo.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      notifyCourseChange(tab.id, tab.url);
    }
  } catch { /* tab may not be accessible */ }
});

// Handle messages from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return undefined;
  }

  if (message.type === "SCRAPE_MODULES_PROGRESS") {
    forwardDiscoveryProgress(message);
    return undefined;
  }

  if (message.type === "CHAT_QUERY") {
    handleChatQuery(message.query, message.context, message.courseId, message.history).then(sendResponse);
    return true; // Keep the message channel open for async response
  }

  if (message.type === "GENERATE_STUDY_TOOL") {
    handleGenerateStudyTool(message.action, message.courseId, message.courseName).then(sendResponse);
    return true;
  }

  if (message.type === "SCRAPE_MODULES_START") {
    handleScrapeModulesStart(message, sender).then(sendResponse);
    return true;
  }

  if (message.type === "SCRAPE_CANCEL") {
    handleScrapeCancel().then(sendResponse);
    return true;
  }

  if (message.type === "GET_FILE_COUNT") {
    fetchFileCount(message.courseId).then(sendResponse);
    return true;
  }

  return undefined;
});

async function emitScrapeEvent(type, payload = {}) {
  const event = {
    type,
    payload,
    ...payload
  };

  try {
    await chrome.runtime.sendMessage(event);
  } catch {
    // Side panel may not currently be listening.
  }
}

function buildCounts({ discovered = 0, uploaded = 0, ingestStarted = 0, skipped = 0, failed = 0 } = {}) {
  return { discovered, uploaded, ingestStarted, skipped, failed };
}

function cloneCounts(counts) {
  return buildCounts(counts || {});
}

function fileIdForEntry(file, index) {
  const identity = fileIdentityKey(file);
  if (identity.startsWith("file:")) {
    return identity;
  }
  if (file && typeof file === "object") {
    if (typeof file.fileUrl === "string" && file.fileUrl.trim()) {
      return file.fileUrl.trim();
    }
    if (typeof file.url === "string" && file.url.trim()) {
      return file.url.trim();
    }
  }
  return `file-${index + 1}`;
}

function fileNameForEntry(file, fallback = "") {
  if (file && typeof file === "object") {
    if (typeof file.filename === "string" && file.filename.trim()) {
      return file.filename.trim();
    }
    if (typeof file.title === "string" && file.title.trim()) {
      return file.title.trim();
    }
    if (typeof file.url === "string" && file.url.trim()) {
      return file.url.trim();
    }
  }
  return fallback || "Unknown file";
}

function normalizeProgressText(progress) {
  if (!progress || typeof progress !== "object") {
    return "Discovering course files...";
  }
  if (typeof progress.message === "string" && progress.message.trim()) {
    return progress.message.trim();
  }
  if (typeof progress.stage === "string" && progress.stage.trim()) {
    return `Discovery stage: ${progress.stage.trim()}`;
  }
  return "Discovering course files...";
}

function forwardDiscoveryProgress(message) {
  if (!activeScrapeRun) {
    return;
  }
  const progress = message && typeof message.progress === "object" ? message.progress : {};
  void emitScrapeEvent("SCRAPE_PROGRESS", {
    runId: activeScrapeRun.id,
    stage: "discovering",
    status: "discovering",
    statusText: normalizeProgressText(progress),
    message: normalizeProgressText(progress),
    progress
  });
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function readCourseIdFromObject(value) {
  if (!value || typeof value !== "object") {
    return "";
  }

  const direct = nonEmptyString(value.courseId) || nonEmptyString(value.course_id);
  if (direct) {
    return direct;
  }

  return "";
}

function determineCourseId({ message, tabUrl, discoveryResponse, file }) {
  return (
    nonEmptyString(message?.courseId) ||
    readCourseIdFromObject(message?.payload) ||
    nonEmptyString(file?.courseId) ||
    readCourseIdFromObject(file?.raw) ||
    readCourseIdFromObject(discoveryResponse) ||
    readCourseIdFromObject(discoveryResponse?.payload) ||
    extractCourseIdFromUrl(tabUrl)
  );
}

function dedupeKeyForFile(file, index) {
  const identity = fileIdentityKey(file);
  if (identity) {
    return identity;
  }
  return `dedupe-${index + 1}`;
}

function extractCanvasFileIdFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return "";
  }
  try {
    const parsed = new URL(rawUrl);
    const match = parsed.pathname.match(/\/files\/(\d+)(?:\/|$)/i);
    return match && match[1] ? match[1] : "";
  } catch {
    return "";
  }
}

function canonicalizeFileUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return "";
  }
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    ["download_frd", "module_item_id", "module_id", "verifier", "wrap"].forEach((key) => {
      parsed.searchParams.delete(key);
    });
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

function fileIdentityKey(file) {
  if (!file || typeof file !== "object") {
    return "";
  }

  const candidates = [];
  if (typeof file.url === "string" && file.url.trim()) {
    candidates.push(file.url.trim());
  }
  if (typeof file.fileUrl === "string" && file.fileUrl.trim()) {
    candidates.push(file.fileUrl.trim());
  }
  if (typeof file.sourceUrl === "string" && file.sourceUrl.trim()) {
    candidates.push(file.sourceUrl.trim());
  }

  for (const candidate of candidates) {
    const fileId = extractCanvasFileIdFromUrl(candidate);
    if (fileId) {
      return `file:${fileId}`;
    }
  }
  for (const candidate of candidates) {
    const normalized = canonicalizeFileUrl(candidate);
    if (normalized) {
      return `url:${normalized}`;
    }
  }

  return "";
}

function dedupeDiscoveredFiles(files) {
  const unique = [];
  const seen = new Set();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const key = dedupeKeyForFile(file, index);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(file);
  }
  return unique;
}

function createAbortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function extractCourseIdFromUrl(url) {
  if (typeof url !== "string") {
    return "";
  }
  const match = url.match(/\/courses\/([^/?#]+)/);
  if (!match || !match[1]) {
    return "";
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function assertNotCancelled(run) {
  if (!run) {
    return;
  }

  if (run.cancelled || run.controller.signal.aborted) {
    throw createAbortError("Scrape cancelled");
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) {
    throw new Error("No active tab found.");
  }

  const tab = tabs[0];
  if (typeof tab.id !== "number") {
    throw new Error("Active tab id is unavailable.");
  }

  return tab;
}

function isCanvasUrl(url) {
  return typeof url === "string" && /^https:\/\/canvas\.calpoly\.edu\//i.test(url);
}

function isReceivingEndError(error) {
  const message = nonEmptyString(error && error.message ? error.message : String(error));
  if (!message) {
    return false;
  }
  return message.toLowerCase().includes("receiving end does not exist");
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function requestDiscoveryFromTab(tab, message, runId) {
  const request = buildScrapeRequest({ ...message, requestId: runId });
  try {
    return await chrome.tabs.sendMessage(tab.id, request);
  } catch (error) {
    if (!isReceivingEndError(error)) {
      throw error;
    }
    await ensureContentScript(tab.id);
    return await chrome.tabs.sendMessage(tab.id, request);
  }
}

async function handleScrapeCancel() {
  if (!activeScrapeRun) {
    return { success: false, error: "No scrape job is currently running." };
  }

  activeScrapeRun.cancelled = true;
  activeScrapeRun.controller.abort();

  await emitScrapeEvent("SCRAPE_PROGRESS", {
    runId: activeScrapeRun.id,
    stage: "cancel_requested",
    status: "cancel_requested",
    statusText: "Cancellation requested.",
    message: "Cancellation requested."
  });

  return {
    success: true,
    cancelled: true,
    runId: activeScrapeRun.id
  };
}

function buildScrapeRequest(message) {
  const request = { type: "SCRAPE_MODULES_START" };

  if (message && typeof message === "object") {
    if (message.payload !== undefined) {
      request.payload = message.payload;
    }
    if (message.options !== undefined) {
      request.options = message.options;
    }
    if (message.filters !== undefined) {
      request.filters = message.filters;
    }
    if (nonEmptyString(message.courseId)) {
      request.courseId = message.courseId;
    }
    if (nonEmptyString(message.requestId)) {
      request.requestId = message.requestId;
    }
  }

  return request;
}

async function handleScrapeModulesStart(message) {
  if (activeScrapeRun) {
    const error = "A scrape job is already running.";
    await emitScrapeEvent("SCRAPE_ERROR", {
      runId: activeScrapeRun.id,
      error
    });
    return { success: false, error, runId: activeScrapeRun.id };
  }

  const runId = `scrape-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const run = {
    id: runId,
    cancelled: false,
    controller: new AbortController()
  };
  activeScrapeRun = run;

  const counts = buildCounts();
  const fileEvents = [];
  const seenKeys = new Set();
  let total = 0;
  const results = [];
  let defaultCourseId = "";
  let canvasUpload = null;

  try {
    canvasUpload = ensureCanvasUploadLoaded();
    assertNotCancelled(run);

    await emitScrapeEvent("SCRAPE_PROGRESS", {
      runId,
      reset: true,
      stage: "discovering",
      status: "discovering",
      statusText: "Requesting course files from content script.",
      counts: cloneCounts(counts),
      current: 0,
      total: 0,
      message: "Requesting course files from content script."
    });

	    const tab = await getActiveTab();
	    if (!isCanvasUrl(tab.url || "")) {
	      throw new Error("Open a Canvas course page on canvas.calpoly.edu, then run scrape again.");
	    }
	    const discoveryResponse = await requestDiscoveryFromTab(tab, message, runId);
	    if (discoveryResponse && discoveryResponse.success === false) {
	      throw new Error(nonEmptyString(discoveryResponse.error) || "Content script discovery failed.");
	    }

    const discoveredFiles = dedupeDiscoveredFiles(canvasUpload.normalizeDiscoveredFiles(discoveryResponse));
    total = discoveredFiles.length;
    counts.discovered = total;
    defaultCourseId = determineCourseId({
      message,
      tabUrl: tab.url || "",
      discoveryResponse,
      file: null
    });

    await emitScrapeEvent("SCRAPE_PROGRESS", {
      runId,
      stage: "discovered",
      status: "discovered",
      statusText: `Discovered ${total} file(s).`,
      counts: cloneCounts(counts),
      current: 0,
      total,
      discovered: counts.discovered,
      courseId: defaultCourseId,
      message: `Discovered ${total} files.`
    });

    if (total === 0) {
      const completedAt = new Date().toISOString();
      const completePayload = {
        runId,
        startedAt,
        completedAt,
        total,
        processed: 0,
        counts: cloneCounts(counts),
        files: fileEvents,
        results,
        cancelled: false
      };

      await emitScrapeEvent("SCRAPE_COMPLETE", completePayload);
      return {
        success: true,
        ...completePayload
      };
    }

    for (let index = 0; index < discoveredFiles.length; index += 1) {
      assertNotCancelled(run);

      const discoveredFile = discoveredFiles[index];
      const dedupeKey = dedupeKeyForFile(discoveredFile, index);
      const fileId = fileIdForEntry(discoveredFile, index);
      const fileName = fileNameForEntry(discoveredFile, dedupeKey);

      if (seenKeys.has(dedupeKey)) {
        counts.skipped += 1;
        const duplicateEvent = {
          id: fileId,
          name: fileName,
          status: "skipped",
          detail: "Duplicate discovered link."
        };
        fileEvents.push(duplicateEvent);
        await emitScrapeEvent("SCRAPE_PROGRESS", {
          runId,
          stage: "skipped",
          status: "skipped",
          statusText: `Skipped duplicate: ${fileName}`,
          counts: cloneCounts(counts),
          current: index + 1,
          total,
          file: duplicateEvent,
          message: `Skipped duplicate ${fileName}`
        });
        continue;
      }
      seenKeys.add(dedupeKey);

      const fileCourseId = determineCourseId({
        message,
        tabUrl: tab.url || "",
        discoveryResponse,
        file: discoveredFile
      });

      if (!fileCourseId) {
        throw new Error(`Unable to determine courseId for discovered file ${index + 1}.`);
      }

      const displayName = fileName;

      await emitScrapeEvent("SCRAPE_PROGRESS", {
        runId,
        stage: "uploading",
        status: "uploading",
        statusText: `Uploading ${displayName}`,
        counts: cloneCounts(counts),
        current: index + 1,
        total,
        file: {
          id: fileId,
          name: displayName,
          status: "uploading",
          detail: "Uploading to S3..."
        },
        courseId: fileCourseId,
        message: `Uploading ${displayName}`
      });
      try {
        const uploaded = await canvasUpload.uploadAndIngestFile({
          apiBaseUrl: API_BASE_URL,
          courseId: fileCourseId,
          file: discoveredFile,
          signal: run.controller.signal
        });

        counts.uploaded += 1;
        counts.ingestStarted += 1;

        const fileResult = {
          index: index + 1,
          sourceUrl: discoveredFile.url,
          filename: uploaded.filename,
          contentType: uploaded.contentType,
          sizeBytes: uploaded.sizeBytes,
          docId: uploaded.docId,
          key: uploaded.key,
          ingestJobId: uploaded.jobId,
          ingestStatus: uploaded.status,
          courseId: fileCourseId
        };
        results.push(fileResult);

        const ingestedEvent = {
          id: fileId,
          name: uploaded.filename,
          status: "uploaded",
          detail: uploaded.jobId
            ? `Uploaded; ingest started (jobId: ${uploaded.jobId})`
            : "Uploaded; ingest started."
        };
        fileEvents.push(ingestedEvent);

        await emitScrapeEvent("SCRAPE_PROGRESS", {
          runId,
          stage: "ingested",
          status: "uploaded",
          statusText: `Uploaded ${uploaded.filename}`,
          counts: cloneCounts(counts),
          current: index + 1,
          total,
          file: ingestedEvent,
          courseId: fileCourseId,
          docId: uploaded.docId,
          ingestJobId: uploaded.jobId,
          message: `Uploaded ${uploaded.filename}; ingest started`
        });
      } catch (error) {
        if (run.cancelled || (canvasUpload && canvasUpload.isAbortError(error))) {
          throw error;
        }

        if (canvasUpload && canvasUpload.isUnsupportedFileTypeError(error)) {
          counts.skipped += 1;
          const skippedEvent = {
            id: fileId,
            name: displayName,
            status: "skipped",
            detail: canvasUpload.toErrorMessage(error)
          };
          fileEvents.push(skippedEvent);
          await emitScrapeEvent("SCRAPE_PROGRESS", {
            runId,
            stage: "skipped",
            status: "skipped",
            statusText: `Skipped ${displayName}`,
            counts: cloneCounts(counts),
            current: index + 1,
            total,
            file: skippedEvent,
            courseId: fileCourseId,
            message: skippedEvent.detail
          });
          continue;
        }

        counts.failed += 1;
        const failedEvent = {
          id: fileId,
          name: displayName,
          status: "failed",
          detail: canvasUpload ? canvasUpload.toErrorMessage(error) : String(error)
        };
        fileEvents.push(failedEvent);
        await emitScrapeEvent("SCRAPE_PROGRESS", {
          runId,
          stage: "failed",
          status: "failed",
          statusText: `Failed ${displayName}`,
          counts: cloneCounts(counts),
          current: index + 1,
          total,
          file: failedEvent,
          courseId: fileCourseId,
          message: failedEvent.detail
        });
      }
    }

    const completedAt = new Date().toISOString();
    const processed = counts.uploaded + counts.skipped + counts.failed;
    const completePayload = {
      runId,
      startedAt,
      completedAt,
      total,
      processed,
      counts: cloneCounts(counts),
      files: fileEvents,
      results,
      cancelled: false
    };

    await emitScrapeEvent("SCRAPE_COMPLETE", completePayload);

    return {
      success: true,
      ...completePayload
    };
  } catch (error) {
    const completedAt = new Date().toISOString();

	    if (run.cancelled || (canvasUpload && canvasUpload.isAbortError(error))) {
	      const cancelPayload = {
        runId,
        startedAt,
        completedAt,
        total,
        processed: counts.uploaded + counts.skipped + counts.failed,
        counts: cloneCounts(counts),
        files: fileEvents,
        results,
        cancelled: true
      };

      await emitScrapeEvent("SCRAPE_COMPLETE", cancelPayload);
      return {
        success: true,
        ...cancelPayload
      };
    }

	    const errorMessage = canvasUpload ? canvasUpload.toErrorMessage(error) : String(error);
    await emitScrapeEvent("SCRAPE_ERROR", {
      runId,
      startedAt,
      completedAt,
      total,
      processed: counts.uploaded + counts.skipped + counts.failed,
      counts: cloneCounts(counts),
      files: fileEvents,
      error: errorMessage
    });

    return {
      success: false,
      runId,
      error: errorMessage,
      total,
      processed: counts.uploaded + counts.skipped + counts.failed,
      counts: cloneCounts(counts),
      files: fileEvents,
      results
    };
  } finally {
    if (activeScrapeRun && activeScrapeRun.id === runId) {
      activeScrapeRun = null;
    }
  }
}

async function fetchFileCount(courseId) {
  if (!courseId) {
    return { success: false, error: "No courseId provided", fileCount: 0 };
  }
  try {
    const url = `${API_BASE_URL}/courses/${encodeURIComponent(courseId)}/files/count`;
    const response = await fetch(url);
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data ? JSON.stringify(data) : response.statusText);
    }
    return { success: true, fileCount: data.fileCount || 0 };
  } catch (err) {
    return { success: false, error: err.message, fileCount: 0 };
  }
}

async function handleChatQuery(query, pageContext, explicitCourseId, history) {
  try {
    const body = { question: query };

    // Use explicit courseId from side panel (per-course tabs) first
    if (explicitCourseId) {
      body.courseId = explicitCourseId;
    }

    // Fall back to active tab URL
    if (!body.courseId) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
          const match = tab.url.match(/\/courses\/(\d+)/);
          if (match) {
            body.courseId = match[1];
          }
        }
      } catch {
        // tabs API unavailable — fall back to context
      }
    }

    // Fall back to content script context
    if (!body.courseId && pageContext && pageContext.courseId) {
      body.courseId = pageContext.courseId;
    }
    if (pageContext) {
      body.context = pageContext;
    }
    if (Array.isArray(history) && history.length > 0) {
      body.history = history;
    }

    const response = await fetch(CHAT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = data ? JSON.stringify(data, null, 2) : response.statusText;
      throw new Error(`API ${response.status}: ${detail}`);
    }

    return { success: true, answer: data.answer || data.message || JSON.stringify(data), action: data.action || null };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleGenerateStudyTool(action, courseId, courseName) {
  try {
    let data;

    if (action.type === "flashcards") {
      // --- Async: start generation job ---
      const startResponse = await fetch(`${API_BASE_URL}/generate/flashcards-from-materials/jobs`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          courseId: courseId,
          materialIds: action.materialIds || [],
          numCards: action.count || 12
        })
      });
      if (!startResponse.ok) {
        const detail = await startResponse.text().catch(() => startResponse.statusText);
        throw new Error(`Failed to start generation (${startResponse.status}): ${detail}`);
      }
      const startData = await startResponse.json();
      const jobId = startData.jobId;
      if (!jobId) {
        throw new Error("Server did not return a jobId");
      }

      // --- Async: poll for completion ---
      const POLL_INTERVAL_MS = 4000;
      const MAX_POLL_ATTEMPTS = 60; // 4 minutes max
      let pollResult = null;

      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

        const pollResponse = await fetch(
          `${API_BASE_URL}/generate/flashcards-from-materials/jobs/${encodeURIComponent(jobId)}`
        );
        if (!pollResponse.ok) {
          continue; // Transient error, keep polling
        }
        const pollData = await pollResponse.json();

        if (pollData.status === "FINISHED") {
          pollResult = pollData;
          break;
        }
        if (pollData.status === "FAILED") {
          throw new Error(pollData.error || "Flashcard generation failed");
        }
        // status === "RUNNING" — keep polling
      }

      if (!pollResult) {
        throw new Error("Flashcard generation timed out — please try with fewer materials");
      }

      data = pollResult.cards;

      // Build import payload
      const payload = {
        type: "deck",
        title: `${courseName || courseId} Flashcards`,
        courseId: courseId,
        courseName: courseName || courseId,
        resourceLabels: action.materialNames || [],
        cards: data
      };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const url = `${WEBAPP_BASE_URL}/import#${encoded}`;
      chrome.tabs.create({ url });
      return { success: true };

    } else if (action.type === "practice_exam") {
      const response = await fetch(`${API_BASE_URL}/generate/practice-exam`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          courseId: courseId,
          numQuestions: action.count || 10
        })
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        throw new Error(`Generation failed (${response.status}): ${detail}`);
      }
      data = await response.json();

      const payload = {
        type: "practiceTest",
        title: `${courseName || courseId} Practice Exam`,
        courseId: courseId,
        courseName: courseName || courseId,
        exam: data
      };
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const url = `${WEBAPP_BASE_URL}/import#${encoded}`;
      chrome.tabs.create({ url });
      return { success: true };

    } else {
      return { success: false, error: `Unknown action type: ${action.type}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}
