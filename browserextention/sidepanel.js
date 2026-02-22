const messagesContainer = document.getElementById("messages");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const courseTabsContainer = document.getElementById("courseTabs");
const scrapeBtn = document.getElementById("scrapeBtn");
const retryScrapeBtn = document.getElementById("retryScrapeBtn");
const scrapeStatusText = document.getElementById("scrapeStatusText");
const scrapeFileList = document.getElementById("scrapeFileList");
const counterEls = {
  discovered: document.getElementById("countDiscovered"),
  uploaded: document.getElementById("countUploaded"),
  ingestStarted: document.getElementById("countIngestStarted"),
  skipped: document.getElementById("countSkipped"),
  failed: document.getElementById("countFailed")
};

const scrapeToggle = document.getElementById("scrapeToggle");
const scrapePanel = document.querySelector(".scrape-panel");
const filesLoadedBadge = document.getElementById("filesLoadedBadge");
const filesLoadedCount = document.getElementById("filesLoadedCount");

const SCRAPE_START_MESSAGE_TYPE = "SCRAPE_MODULES_START";
const MAX_FILE_ROWS = 200;

// --- Per-course state ---
let currentCourseId = null;
let currentCourseName = null;
let currentCourseFileCount = 0;
let courseRegistry = []; // [{courseId, courseName}]

// Subtle pastel palette — bg for chat area, dot for the tab indicator
const COURSE_COLORS = [
  { bg: "#eef4fb", dot: "#4a90d9" },  // blue
  { bg: "#edf7ee", dot: "#4caf50" },  // green
  { bg: "#f4eefb", dot: "#9c5fc7" },  // purple
  { bg: "#fef5ea", dot: "#e8a035" },  // orange
  { bg: "#fbeef2", dot: "#d94f73" },  // pink
  { bg: "#eef7f6", dot: "#3faea0" },  // teal
  { bg: "#fbf7ee", dot: "#c4a535" },  // gold
  { bg: "#eeeef9", dot: "#5c6bc0" },  // indigo
];

const scrapeState = {
  phase: "idle",
  statusText: "Idle",
  counts: zeroCounts(),
  files: new Map()
};

renderScrapeUI();

// Initialize: load course registry, detect current course, load chat
initCourseContext();

sendBtn.addEventListener("click", sendMessage);
if (scrapeBtn) {
  scrapeBtn.addEventListener("click", () => startScrapeWorkflow("manual"));
}
if (retryScrapeBtn) {
  retryScrapeBtn.addEventListener("click", () => startScrapeWorkflow("retry"));
}

// Scrape drawer toggle
if (scrapeToggle && scrapePanel) {
  scrapeToggle.addEventListener("click", () => {
    const isCollapsed = scrapePanel.classList.toggle("collapsed");
    scrapeToggle.setAttribute("aria-expanded", String(!isCollapsed));
  });
}

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object" || !message.type) {
    return;
  }

  const payload = extractPayload(message);
  switch (message.type) {
    case "COURSE_CHANGED":
      if (message.courseId) {
        switchCourse(message.courseId, message.courseName || `Course ${message.courseId}`);
      }
      break;
    case "SCRAPE_PROGRESS":
      handleScrapeProgress(payload);
      break;
    case "SCRAPE_COMPLETE":
      handleScrapeComplete(payload);
      break;
    case "SCRAPE_ERROR":
      handleScrapeError(payload);
      break;
    default:
      break;
  }
});

async function startScrapeWorkflow(trigger) {
  if (scrapeState.phase === "running") {
    return;
  }

  scrapeState.phase = "running";
  scrapeState.statusText = "Starting scrape workflow...";
  scrapeState.counts = zeroCounts();
  scrapeState.files.clear();

  // Auto-expand the drawer when a scrape starts
  if (scrapePanel && scrapePanel.classList.contains("collapsed")) {
    scrapePanel.classList.remove("collapsed");
    if (scrapeToggle) scrapeToggle.setAttribute("aria-expanded", "true");
  }

  renderScrapeUI();

  try {
    const response = await chrome.runtime.sendMessage({
      type: SCRAPE_START_MESSAGE_TYPE,
      trigger,
      source: "sidepanel"
    });

    if (response && response.success === false) {
      throw new Error(response.error || "Scrape workflow failed to start.");
    }

    if (response && response.counts && typeof response.counts === "object") {
      mergeCountsFromPayload(response);
    }
    if (response && Array.isArray(response.files) && response.files.length > 0) {
      applyFileUpdates({ files: response.files });
    }
    if (response && response.success === true) {
      scrapeState.phase = response.cancelled ? "error" : "complete";
    }

    const responseMessage = firstString([
      response && response.total === 0 ? "Scrape completed: no files discovered." : "",
      response && response.message,
      response && response.statusText
    ]);
    if (response && response.success === true) {
      scrapeState.statusText = responseMessage || "Scrape workflow complete.";
    } else {
      scrapeState.statusText = responseMessage || "Scrape started. Waiting for progress...";
    }
    renderScrapeUI();
  } catch (err) {
    handleScrapeError({ error: `Unable to start scrape workflow: ${err.message}` });
  }
}

function handleScrapeProgress(payload) {
  if (payload && payload.reset === true) {
    scrapeState.counts = zeroCounts();
    scrapeState.files.clear();
  }

  scrapeState.phase = "running";

  const fileChanged = applyFileUpdates(payload);
  const hasExplicitCounts = mergeCountsFromPayload(payload);
  if (!hasExplicitCounts && fileChanged) {
    syncCountsFromFileStages();
  }

  const statusText = firstString([
    payload.statusText,
    payload.progressText,
    payload.message
  ]);
  scrapeState.statusText = statusText || "Scrape workflow in progress...";
  renderScrapeUI();
}

function handleScrapeComplete(payload) {
  const fileChanged = applyFileUpdates(payload);
  const hasExplicitCounts = mergeCountsFromPayload(payload);
  if (!hasExplicitCounts && fileChanged) {
    syncCountsFromFileStages();
  }

  scrapeState.phase = "complete";
  scrapeState.statusText = firstString([
    payload.statusText,
    payload.message,
    "Scrape workflow complete."
  ]);
  renderScrapeUI();

  // Refresh file count from S3 after scrape finishes
  if (currentCourseId) {
    loadCourseFileCount(currentCourseId).then(() => updateFilesLoadedBadge());
  }
}

function handleScrapeError(payload) {
  const errorText = firstString([
    payload.error,
    payload.message,
    payload.reason,
    "Scrape workflow failed."
  ]);

  applyFileUpdates(payload);

  const failedSource = payload.file && typeof payload.file === "object"
    ? payload.file
    : payload;
  const failedFile = buildFileUpdate(
    {
      ...failedSource,
      id: failedSource.id || failedSource.fileId || payload.fileId,
      name: failedSource.name || failedSource.fileName || payload.fileName,
      path: failedSource.path || payload.path,
      status: "failed",
      detail: errorText
    },
    payload
  );
  if (failedFile) {
    upsertFileStatus(failedFile);
  }

  const hasExplicitCounts = mergeCountsFromPayload(payload);
  if (!hasExplicitCounts) {
    syncCountsFromFileStages();
  }

  scrapeState.phase = "error";
  scrapeState.statusText = errorText;
  renderScrapeUI();
}

function applyFileUpdates(payload) {
  let changed = false;
  const files = Array.isArray(payload.files) ? payload.files : [];

  for (const file of files) {
    const update = buildFileUpdate(file, payload);
    if (update) {
      upsertFileStatus(update);
      changed = true;
    }
  }

  const singleUpdateSource = payload.file && typeof payload.file === "object"
    ? payload.file
    : payload;
  const singleUpdate = buildFileUpdate(singleUpdateSource, payload);
  if (singleUpdate) {
    upsertFileStatus(singleUpdate);
    changed = true;
  }

  return changed;
}

function buildFileUpdate(source, fallbackSource) {
  const src = source && typeof source === "object" ? source : {};
  const fallback = fallbackSource && typeof fallbackSource === "object" ? fallbackSource : {};

  const fileName = firstString([
    src.name,
    src.fileName,
    src.filename,
    src.path,
    fallback.fileName,
    fallback.filename,
    fallback.path
  ]);

  const fileId = firstString([
    src.id,
    src.fileId,
    src.key,
    fallback.fileId,
    fileName
  ]);

  const status = normalizeStatus(firstString([
    src.status,
    src.state,
    src.step,
    fallback.status,
    fallback.state,
    fallback.step
  ]));

  const detail = firstString([
    src.detail,
    src.message,
    src.error,
    fallback.detail,
    fallback.message,
    fallback.error
  ]);

  if (!fileName && !fileId) {
    return null;
  }

  return {
    id: fileId || fileName,
    name: fileName || fileId,
    status: status || "discovered",
    detail: detail || ""
  };
}

function upsertFileStatus(update) {
  const existing = scrapeState.files.get(update.id) || {
    id: update.id,
    name: update.name || update.id,
    status: "discovered",
    detail: "",
    updatedAt: Date.now(),
    stages: {
      discovered: false,
      uploaded: false,
      ingestStarted: false,
      skipped: false,
      failed: false
    }
  };

  existing.name = update.name || existing.name;
  existing.status = update.status || existing.status;
  existing.detail = update.detail || existing.detail;
  existing.updatedAt = Date.now();
  applyStage(existing, existing.status);

  scrapeState.files.set(update.id, existing);
  if (scrapeState.files.size > MAX_FILE_ROWS) {
    const oldestKey = scrapeState.files.keys().next().value;
    scrapeState.files.delete(oldestKey);
  }
}

function applyStage(fileEntry, status) {
  const normalizedStatus = normalizeStatus(status);
  fileEntry.stages.discovered = true;

  if (normalizedStatus === "uploaded" || normalizedStatus === "complete") {
    fileEntry.stages.uploaded = true;
  }
  if (normalizedStatus === "ingest-started" || normalizedStatus === "complete") {
    fileEntry.stages.uploaded = true;
    fileEntry.stages.ingestStarted = true;
  }
  if (normalizedStatus === "skipped") {
    fileEntry.stages.skipped = true;
  }
  if (normalizedStatus === "failed") {
    fileEntry.stages.failed = true;
  }
}

function mergeCountsFromPayload(payload) {
  const countSources = [
    payload.counts,
    payload.summary,
    payload.stats,
    payload
  ].filter(Boolean);

  let updated = false;
  for (const source of countSources) {
    updated = setCounterFromSource(source, "discovered", [
      "discovered",
      "discoveredCount",
      "filesDiscovered",
      "totalDiscovered"
    ]) || updated;
    updated = setCounterFromSource(source, "uploaded", [
      "uploaded",
      "uploadedCount",
      "filesUploaded"
    ]) || updated;
    updated = setCounterFromSource(source, "ingestStarted", [
      "ingestStarted",
      "ingest_started",
      "ingest-started",
      "ingestStartedCount"
    ]) || updated;
    updated = setCounterFromSource(source, "skipped", [
      "skipped",
      "skippedCount",
      "filesSkipped"
    ]) || updated;
    updated = setCounterFromSource(source, "failed", [
      "failed",
      "failedCount",
      "filesFailed"
    ]) || updated;
  }

  return updated;
}

function setCounterFromSource(source, counterKey, keys) {
  if (!source || typeof source !== "object") {
    return false;
  }
  for (const key of keys) {
    if (!(key in source)) {
      continue;
    }
    const value = Number(source[key]);
    if (Number.isFinite(value) && value >= 0) {
      scrapeState.counts[counterKey] = value;
      return true;
    }
  }
  return false;
}

function syncCountsFromFileStages() {
  const counts = zeroCounts();
  for (const file of scrapeState.files.values()) {
    if (file.stages.discovered) counts.discovered += 1;
    if (file.stages.uploaded) counts.uploaded += 1;
    if (file.stages.ingestStarted) counts.ingestStarted += 1;
    if (file.stages.skipped) counts.skipped += 1;
    if (file.stages.failed) counts.failed += 1;
  }
  scrapeState.counts = counts;
}

function renderScrapeUI() {
  if (!scrapeStatusText) {
    return;
  }

  scrapeStatusText.textContent = scrapeState.statusText;
  scrapeStatusText.classList.remove("state-running", "state-complete", "state-error");
  if (scrapeState.phase === "running") {
    scrapeStatusText.classList.add("state-running");
  } else if (scrapeState.phase === "complete") {
    scrapeStatusText.classList.add("state-complete");
  } else if (scrapeState.phase === "error") {
    scrapeStatusText.classList.add("state-error");
  }

  if (counterEls.discovered) {
    counterEls.discovered.textContent = String(scrapeState.counts.discovered);
  }
  if (counterEls.uploaded) {
    counterEls.uploaded.textContent = String(scrapeState.counts.uploaded);
  }
  if (counterEls.ingestStarted) {
    counterEls.ingestStarted.textContent = String(scrapeState.counts.ingestStarted);
  }
  if (counterEls.skipped) {
    counterEls.skipped.textContent = String(scrapeState.counts.skipped);
  }
  if (counterEls.failed) {
    counterEls.failed.textContent = String(scrapeState.counts.failed);
  }

  if (scrapeBtn) {
    scrapeBtn.disabled = scrapeState.phase === "running";
  }
  if (retryScrapeBtn) {
    retryScrapeBtn.classList.toggle("hidden", scrapeState.phase !== "error");
    retryScrapeBtn.disabled = scrapeState.phase === "running";
  }

  updateFilesLoadedBadge();
  renderFileRows();
}

function updateFilesLoadedBadge() {
  if (!filesLoadedBadge || !filesLoadedCount) return;
  if (currentCourseFileCount > 0) {
    filesLoadedCount.textContent = String(currentCourseFileCount);
    filesLoadedBadge.classList.remove("hidden");
  } else {
    filesLoadedBadge.classList.add("hidden");
  }
}

function renderFileRows() {
  if (!scrapeFileList) {
    return;
  }

  scrapeFileList.innerHTML = "";
  const rows = Array.from(scrapeState.files.values()).sort((a, b) => b.updatedAt - a.updatedAt);

  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "file-row empty";
    empty.textContent = "No file activity yet.";
    scrapeFileList.appendChild(empty);
    return;
  }

  for (const row of rows) {
    const li = document.createElement("li");
    li.className = `file-row ${row.status === "failed" ? "failed" : ""}`.trim();

    const main = document.createElement("div");
    main.className = "file-main";

    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = row.name;
    main.appendChild(name);

    const detail = document.createElement("span");
    detail.className = "file-detail";
    detail.textContent = row.detail || `Updated ${formatTime(row.updatedAt)}`;
    main.appendChild(detail);

    const badge = document.createElement("span");
    const statusClass = sanitizeToken(row.status);
    badge.className = `file-status-badge status-${statusClass}`;
    badge.textContent = humanizeStatus(row.status);

    li.appendChild(main);
    li.appendChild(badge);
    scrapeFileList.appendChild(li);
  }
}

function zeroCounts() {
  return {
    discovered: 0,
    uploaded: 0,
    ingestStarted: 0,
    skipped: 0,
    failed: 0
  };
}

function extractPayload(message) {
  if (message.payload && typeof message.payload === "object") {
    return message.payload;
  }
  if (message.data && typeof message.data === "object") {
    return message.data;
  }
  return message;
}

function normalizeStatus(rawStatus) {
  const cleaned = sanitizeToken(rawStatus || "discovered");

  if (cleaned === "success" || cleaned === "done" || cleaned === "completed" || cleaned === "finished") {
    return "complete";
  }
  if (cleaned === "error") {
    return "failed";
  }
  if (cleaned === "ingeststarted" || cleaned === "ingest-start" || cleaned === "ingesting") {
    return "ingest-started";
  }
  if (cleaned === "ingested") {
    return "ingest-started";
  }
  if (cleaned === "upload-complete" || cleaned === "upload-success") {
    return "uploaded";
  }
  return cleaned;
}

function sanitizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function humanizeStatus(status) {
  return String(status || "unknown")
    .split("-")
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return "";
  }
}

function firstString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

async function getRecentHistory(courseId, limit = 5) {
  if (!courseId) return [];
  const key = `chatHistory_${courseId}`;
  const result = await chrome.storage.local.get(key);
  const history = result[key] || [];
  return history
    .filter(msg => msg.role === "user" || msg.role === "bot")
    .slice(-limit)
    .map(msg => ({
      role: msg.role === "bot" ? "assistant" : msg.role,
      content: msg.text
    }));
}

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;

  userInput.value = "";
  userInput.style.height = "auto";
  sendBtn.disabled = true;

  appendMessage("user", text);
  const typingEl = showTypingIndicator();

  // Try to get page context from the active tab's content script
  let pageContext = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes("canvas.calpoly.edu")) {
      pageContext = await chrome.tabs.sendMessage(tab.id, { type: "GET_CONTEXT" });
    }
  } catch {
    // Content script may not be available — that's fine
  }

  // Retrieve recent chat history for context
  const chatHistory = await getRecentHistory(currentCourseId);

  // Send query to background service worker with explicit courseId
  try {
    const response = await chrome.runtime.sendMessage({
      type: "CHAT_QUERY",
      query: text,
      courseId: currentCourseId,
      context: pageContext,
      history: chatHistory
    });

    typingEl.remove();

    if (response && response.success) {
      if (response.action) {
        appendMessage("bot", buildActionConfirmationMessage(response.answer, response.action));
        renderActionCard(response.action);
      } else {
        appendMessage("bot", response.answer);
      }
    } else {
      const errMsg = (response && response.error) || "Something went wrong.";
      appendMessage("error", errMsg);
    }
  } catch (err) {
    typingEl.remove();
    appendMessage("error", "Failed to reach the extension backend: " + err.message);
  }

  sendBtn.disabled = false;
  userInput.focus();
}

function renderMarkdown(text) {
  // Escape HTML first to prevent XSS
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = escaped.split("\n");
  const out = [];
  let inList = false;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Table rows: lines that start and end with |
    if (/^\|.+\|$/.test(trimmed)) {
      // Skip separator rows like |---|---|
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;

      const cells = trimmed.split("|").slice(1, -1).map(c => c.trim());
      if (!inTable) {
        if (inList) { out.push("</ul>"); inList = false; }
        out.push("<table>");
        // First row is the header
        out.push("<thead><tr>" + cells.map(c => `<th>${c}</th>`).join("") + "</tr></thead><tbody>");
        inTable = true;
        continue;
      }
      out.push("<tr>" + cells.map(c => `<td>${c}</td>`).join("") + "</tr>");
      continue;
    }

    if (inTable) {
      out.push("</tbody></table>");
      inTable = false;
    }

    // Headers
    if (trimmed.startsWith("### ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h4>${trimmed.slice(4)}</h4>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h3>${trimmed.slice(3)}</h3>`);
      continue;
    }

    // List items (- or *)
    if (/^[-*]\s/.test(trimmed)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${trimmed.slice(2)}</li>`);
      continue;
    }
    // Numbered list items
    if (/^\d+\.\s/.test(trimmed)) {
      if (!inList) { out.push("<ol>"); inList = true; }
      out.push(`<li>${trimmed.replace(/^\d+\.\s/, "")}</li>`);
      continue;
    }

    if (inList) {
      out.push(inList ? "</ul>" : "</ol>");
      inList = false;
    }

    // Empty line = paragraph break
    if (trimmed === "") {
      out.push("<br>");
      continue;
    }

    out.push(`<p>${trimmed}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inTable) out.push("</tbody></table>");

  // Inline formatting
  let html = out.join("");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  return html;
}

function buildActionConfirmationMessage(answer, action) {
  const provided = typeof answer === "string" ? answer.trim() : "";
  if (provided && !looksLikeGeneratedStudyContent(provided)) {
    return provided;
  }

  const isFlashcards = action && action.type === "flashcards";
  const typeLabel = isFlashcards ? "Flashcard Deck" : "Practice Exam";
  const count = (action && action.count) || (isFlashcards ? 12 : 10);
  const unit = isFlashcards ? "cards" : "questions";
  const materialNames = Array.isArray(action && action.materialNames) ? action.materialNames : [];

  const lines = [
    "Ready to generate!",
    `${typeLabel} (${count} ${unit})`,
  ];

  if (materialNames.length > 0) {
    lines.push("Materials:");
    for (const name of materialNames) {
      lines.push(String(name));
    }
  }

  return lines.join("\n");
}

function looksLikeGeneratedStudyContent(text) {
  if (text.length > 1200) {
    return true;
  }

  const patterns = [
    /(^|\n)\s*(question|flashcard)\s*\d+[:.)]/i,
    /(^|\n)\s*q[:.)\s]/i,
    /(^|\n)\s*a[:.)\s]/i,
    /(^|\n)\s*answer[:.)\s]/i,
  ];
  if (patterns.some((pattern) => pattern.test(text))) {
    return true;
  }

  const numberedItems = (text.match(/(^|\n)\s*\d+\.\s/g) || []).length;
  if (numberedItems >= 4 && text.includes("?")) {
    return true;
  }

  return false;
}

function renderActionCard(action) {
  const card = document.createElement("div");
  card.className = "action-card";

  const isFlashcards = action.type === "flashcards";
  const typeLabel = isFlashcards ? "Flashcard Deck" : "Practice Exam";
  const count = action.count || (isFlashcards ? 12 : 10);
  const countUnit = isFlashcards ? "cards" : "questions";
  const materialNames = action.materialNames || [];

  let html = `<div class="action-card-title">🍦 Ready to generate!</div>`;
  html += `<div class="action-card-type">${typeLabel} (${count} ${countUnit})</div>`;

  if (materialNames.length > 0) {
    html += `<div class="action-card-materials"><strong>Materials:</strong><ul>`;
    for (const name of materialNames) {
      html += `<li>${name.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</li>`;
    }
    html += `</ul></div>`;
  }

  html += `<button class="action-card-btn" id="generateBtn">Generate &amp; Study</button>`;
  card.innerHTML = html;

  messagesContainer.appendChild(card);
  scrollToBottom();

  // Wire up button
  const btn = card.querySelector("#generateBtn");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Generating...";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "GENERATE_STUDY_TOOL",
        action: action,
        courseId: currentCourseId,
        courseName: currentCourseName
      });

      if (response && response.success) {
        btn.textContent = "Opening...";
        appendMessage("bot", `Your ${typeLabel.toLowerCase()} is ready! Opening in a new tab... 🍦`);
      } else {
        btn.textContent = "Generate & Study";
        btn.disabled = false;
        const errMsg = (response && response.error) || "Generation failed.";
        appendMessage("error", errMsg);
      }
    } catch (err) {
      btn.textContent = "Generate & Study";
      btn.disabled = false;
      appendMessage("error", "Failed to generate: " + err.message);
    }
  });
}

function appendMessage(role, text, save = true) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  if (role === "bot") {
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  messagesContainer.appendChild(div);
  scrollToBottom();

  if (save) {
    saveChatMessage(role, text);
  }
}

function showTypingIndicator() {
  const div = document.createElement("div");
  div.className = "typing-indicator";
  div.innerHTML = "<span></span><span></span><span></span>";
  messagesContainer.appendChild(div);
  scrollToBottom();
  return div;
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function saveChatMessage(role, text) {
  if (!currentCourseId) return;
  const key = `chatHistory_${currentCourseId}`;
  chrome.storage.local.get(key, (result) => {
    const history = result[key] || [];
    history.push({ role, text });
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
    chrome.storage.local.set({ [key]: history });
  });
}

// --- Course tab management ---

async function initCourseContext() {
  // Load course registry
  const stored = await chromeStorageGet("gurtCourses");
  courseRegistry = stored.gurtCourses || [];

  // Detect current course from active tab
  let detectedCourseId = null;
  let detectedCourseName = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const match = tab.url.match(/\/courses\/(\d+)/);
      if (match) {
        detectedCourseId = match[1];
        // Try to get course name from content script
        try {
          const ctx = await chrome.tabs.sendMessage(tab.id, { type: "GET_CONTEXT" });
          if (ctx && ctx.courseName) {
            detectedCourseName = ctx.courseName;
          }
        } catch { /* content script not available */ }
      }
    }
  } catch { /* tabs API unavailable */ }

  // Migrate old flat chatHistory if needed
  const oldData = await chromeStorageGet("chatHistory");
  if (oldData.chatHistory && oldData.chatHistory.length > 0 && detectedCourseId) {
    const newKey = `chatHistory_${detectedCourseId}`;
    const existing = await chromeStorageGet(newKey);
    if (!existing[newKey] || existing[newKey].length === 0) {
      await chromeStorageSet({ [newKey]: oldData.chatHistory });
    }
    await chromeStorageRemove("chatHistory");
  }

  if (detectedCourseId) {
    detectedCourseName = detectedCourseName || `Course ${detectedCourseId}`;
    addCourseToRegistry(detectedCourseId, detectedCourseName);
    currentCourseId = detectedCourseId;
    currentCourseName = detectedCourseName;
  } else if (courseRegistry.length > 0) {
    // No Canvas page open — default to last used course
    const last = courseRegistry[courseRegistry.length - 1];
    currentCourseId = last.courseId;
    currentCourseName = last.courseName;
  }

  renderCourseTabs();
  if (currentCourseId) {
    applyCourseTheme(currentCourseId);
    await loadCourseFileCount(currentCourseId);
    updateFilesLoadedBadge();
    await loadChatHistory(currentCourseId);
  }
}

function addCourseToRegistry(courseId, courseName) {
  const existing = courseRegistry.find(c => c.courseId === courseId);
  if (existing) {
    if (courseName && courseName !== `Course ${courseId}`) {
      existing.courseName = courseName;
    }
    return;
  }
  courseRegistry.push({ courseId, courseName: courseName || `Course ${courseId}` });
  saveCourseRegistry();
}

function saveCourseRegistry() {
  chromeStorageSet({ gurtCourses: courseRegistry });
}

function getCourseColor(courseId) {
  const idx = courseRegistry.findIndex(c => c.courseId === courseId);
  return COURSE_COLORS[(idx === -1 ? 0 : idx) % COURSE_COLORS.length];
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function applyCourseTheme(courseId) {
  const color = getCourseColor(courseId);
  const container = document.querySelector(".chat-container");
  container.style.setProperty("--course-bg", color.bg);
  container.style.setProperty("--badge-color", color.dot);
  container.style.setProperty("--badge-bg", `rgba(${hexToRgb(color.dot)}, 0.12)`);
  container.style.setProperty("--badge-border", `rgba(${hexToRgb(color.dot)}, 0.3)`);
}

function renderCourseTabs() {
  if (!courseTabsContainer) return;
  courseTabsContainer.innerHTML = "";
  for (const course of courseRegistry) {
    const color = getCourseColor(course.courseId);
    const tab = document.createElement("span");
    tab.className = "course-tab" + (course.courseId === currentCourseId ? " active" : "");
    tab.title = course.courseName;

    const dot = document.createElement("span");
    dot.className = "course-color-dot";
    dot.style.backgroundColor = color.dot;
    tab.appendChild(dot);

    const label = document.createTextNode(shortenCourseName(course.courseName, course.courseId));
    tab.appendChild(label);

    courseTabsContainer.appendChild(tab);
  }
}

// Fallback display names for known course IDs
const COURSE_NAME_MAP = {
  "175564": "CSC 202",
  "177366": "PHYS 141",
  "176823": "ENGL 147",
  "175245": "MATH 244",
};

function shortenCourseName(name, courseId) {
  // Check hardcoded map first
  if (courseId && COURSE_NAME_MAP[courseId]) return COURSE_NAME_MAP[courseId];
  if (!name) return "Course";
  // Try to extract "CSC 202" or "PHYS 141" style short names (word-boundary anchored)
  const match = name.match(/\b([A-Z]{2,5}[\s-]\d{3}[A-Z]?)\b/i);
  if (match) return match[1].toUpperCase();
  // Truncate long names
  return name.length > 20 ? name.slice(0, 18) + "..." : name;
}

async function switchCourse(courseId, courseName) {
  if (courseId === currentCourseId) return;

  currentCourseId = courseId;
  currentCourseName = courseName || `Course ${courseId}`;
  addCourseToRegistry(courseId, courseName);
  applyCourseTheme(courseId);

  // Fade out current messages
  messagesContainer.classList.add("fade-out");
  await new Promise(resolve => {
    messagesContainer.addEventListener("transitionend", resolve, { once: true });
    // Safety timeout in case transitionend doesn't fire
    setTimeout(resolve, 250);
  });

  // Swap content while invisible
  messagesContainer.innerHTML = "";
  await loadCourseFileCount(courseId);
  updateFilesLoadedBadge();
  await loadChatHistory(courseId);

  // Fade back in
  messagesContainer.classList.remove("fade-out");
  messagesContainer.classList.add("fade-in");
  await new Promise(resolve => {
    messagesContainer.addEventListener("transitionend", resolve, { once: true });
    setTimeout(resolve, 250);
  });
  messagesContainer.classList.remove("fade-in");

  // Update tabs UI
  renderCourseTabs();
}

async function loadChatHistory(courseId) {
  const key = `chatHistory_${courseId}`;
  const data = await chromeStorageGet(key);
  const history = data[key] || [];
  if (history.length > 0) {
    history.forEach(msg => appendMessage(msg.role, msg.text, false));
    scrollToBottom();
  }
}

async function loadCourseFileCount(courseId) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_FILE_COUNT",
      courseId
    });
    currentCourseFileCount = (response && response.fileCount) || 0;
  } catch {
    currentCourseFileCount = 0;
  }
}

// Chrome storage helpers (Promise-based)
function chromeStorageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
function chromeStorageSet(items) {
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}
function chromeStorageRemove(keys) {
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}
