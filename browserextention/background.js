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
const MAX_FLASHCARD_MATERIAL_IDS = 10;

const BLOCK_CONFIG_KEY = "gurtBlockConfigV1";
const BLOCK_RUNTIME_KEY = "gurtBlockRuntimeV1";
const BLOCK_TICK_ALARM = "GURT_BLOCK_TICK";
const BLOCK_DEBUG_KEY = "gurtBlockDebug";
const BLOCKED_PAGE = "blocked.html";
const BLOCKED_PAGE_URL = chrome.runtime.getURL(BLOCKED_PAGE);
const BLOCKING_ENGINE_CANDIDATES = ["blocking_engine.js", "/blocking_engine.js"];
const POMODORO_NOTIFICATION_ICON = "logo.png";

let blockEngineLoadError = null;
let blockConfig = null;
let blockRuntime = null;
let blockCompiled = null;
let blockRanges = { ranges: [], errors: [] };
let blockInitialized = false;
let activeTabIdForBlocking = null;
let isBrowserWindowFocused = true;

const BLOCK_CONFIG_KEY = "gurtBlockConfigV1";
const BLOCK_RUNTIME_KEY = "gurtBlockRuntimeV1";
const BLOCK_TICK_ALARM = "GURT_BLOCK_TICK";
const BLOCK_DEBUG_KEY = "gurtBlockDebug";
const BLOCKED_PAGE = "blocked.html";
const BLOCKED_PAGE_URL = chrome.runtime.getURL(BLOCKED_PAGE);
const BLOCKING_ENGINE_CANDIDATES = ["blocking_engine.js", "/blocking_engine.js"];
const POMODORO_NOTIFICATION_ICON = "logo.png";

let blockEngineLoadError = null;
let blockConfig = null;
let blockRuntime = null;
let blockCompiled = null;
let blockRanges = { ranges: [], errors: [] };
let blockInitialized = false;
let activeTabIdForBlocking = null;
let isBrowserWindowFocused = true;

let activeScrapeRun = null;

void ensureBlockingStateLoaded().catch((error) => {
  console.error("[Gurt][Block] Failed to initialize blocking state", error);
});

chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  if (tabs && tabs[0] && Number.isInteger(tabs[0].id)) {
    activeTabIdForBlocking = tabs[0].id;
  }
}).catch(() => {
  // Ignore initial tab lookup failures.
});

function logBlock(message, details) {
  if (!blockConfig || !blockConfig[BLOCK_DEBUG_KEY]) {
    return;
  }
  if (details !== undefined) {
    console.log(`[Gurt][Block] ${message}`, details);
    return;
  }
  console.log(`[Gurt][Block] ${message}`);
}

function defaultHardAllowlist() {
  const hosts = new Set([
    "canvas.calpoly.edu",
    "*.canvas-user-content.com"
  ]);

  const parseHost = (value) => {
    try {
      const parsed = new URL(value);
      return parsed.hostname.toLowerCase();
    } catch {
      return "";
    }
  };

  const apiHost = parseHost(CHAT_API_URL);
  const webHost = parseHost(WEBAPP_BASE_URL);
  if (apiHost) hosts.add(apiHost);
  if (webHost) hosts.add(webHost);

  return Array.from(hosts);
}

function ensureBlockingEngineLoaded() {
  if (globalThis.GurtBlockingEngine && typeof globalThis.GurtBlockingEngine.evaluateBlockingDecision === "function") {
    return globalThis.GurtBlockingEngine;
  }

  const attempts = [];
  const candidates = [...BLOCKING_ENGINE_CANDIDATES];
  try {
    const runtimeUrl = chrome.runtime.getURL("blocking_engine.js");
    if (!candidates.includes(runtimeUrl)) {
      candidates.push(runtimeUrl);
    }
  } catch {
    // Ignore URL build errors and rely on fallback candidates.
  }

  for (const candidate of candidates) {
    try {
      importScripts(candidate);
      if (globalThis.GurtBlockingEngine && typeof globalThis.GurtBlockingEngine.evaluateBlockingDecision === "function") {
        blockEngineLoadError = null;
        return globalThis.GurtBlockingEngine;
      }
      attempts.push(`${candidate}: loaded but GurtBlockingEngine API missing`);
    } catch (error) {
      attempts.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const details = attempts.length > 0 ? attempts.join(" | ") : "unknown error";
  const error = new Error(`Unable to load blocking_engine.js (${details})`);
  blockEngineLoadError = error;
  throw error;
}

function nowEpochSec() {
  return Math.floor(Date.now() / 1000);
}

function getStorageLocal(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setStorageLocal(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

async function persistBlockConfig() {
  if (!blockConfig) return;
  await setStorageLocal({ [BLOCK_CONFIG_KEY]: blockConfig });
}

async function persistBlockRuntime() {
  if (!blockRuntime) return;
  await setStorageLocal({ [BLOCK_RUNTIME_KEY]: blockRuntime });
}

function refreshCompiledBlockers() {
  const engine = ensureBlockingEngineLoaded();
  blockCompiled = engine.compileSiteMatchers(blockConfig.sites);
  blockRanges = engine.parseTimeRanges(blockConfig.timeRanges);
}

function getPomodoroSnapshot(now = nowEpochSec()) {
  const engine = ensureBlockingEngineLoaded();
  return engine.getPomodoroState(blockRuntime, blockConfig, now);
}

function snapshotPomodoroRuntime(runtime) {
  const source = runtime && typeof runtime === "object" ? runtime : {};
  return {
    active: Boolean(source.pomodoroActive),
    phase: source.pomodoroPhase || null,
    paused: Boolean(source.pomodoroPaused),
    pendingPhase: source.pomodoroPendingPhase || null
  };
}

async function notifyPomodoroBoundary(completedPhase, pendingPhase) {
  if (!chrome.notifications || typeof chrome.notifications.create !== "function") {
    return;
  }

  const completedLabel = completedPhase === "focus" ? "Focus session complete" : "Break complete";
  const pendingLabel = pendingPhase === "focus" ? "Focus" : "Break";
  const message = `Click Start ${pendingLabel} when you're ready for the next cycle.`;

  await new Promise((resolve) => {
    chrome.notifications.create(
      `gurt-pomodoro-${Date.now()}`,
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL(POMODORO_NOTIFICATION_ICON),
        title: completedLabel,
        message
      },
      () => {
        // Best-effort notification; swallow runtime errors to avoid blocking state updates.
        void chrome.runtime.lastError;
        resolve();
      }
    );
  });
}

async function handlePomodoroTransitionEffects(previousRuntime, source) {
  const previous = snapshotPomodoroRuntime(previousRuntime);
  const current = snapshotPomodoroRuntime(blockRuntime);

  const completedBoundary = previous.active
    && Boolean(previous.phase)
    && !current.active
    && current.paused
    && Boolean(current.pendingPhase)
    && current.pendingPhase !== previous.phase;

  if (completedBoundary) {
    await notifyPomodoroBoundary(previous.phase, current.pendingPhase);
    logBlock(`Pomodoro phase completed from ${source}`, {
      completedPhase: previous.phase,
      pendingPhase: current.pendingPhase
    });
  }

  const pomodoroChanged = previous.active !== current.active
    || previous.phase !== current.phase
    || previous.paused !== current.paused
    || previous.pendingPhase !== current.pendingPhase;

  if (!pomodoroChanged) {
    return;
  }

  if (!current.active || current.phase === "break") {
    await restoreBlockedTabsIfPossible();
    return;
  }

  if (current.phase === "focus") {
    const activeTab = await getActiveTabForBlockStatus();
    if (activeTab && Number.isInteger(activeTab.id) && typeof activeTab.url === "string") {
      await enforceBlockingForTab(activeTab.id, activeTab.url, "pomodoro-transition-focus");
    }
  }
}

async function syncPomodoroState(now = nowEpochSec(), source = "sync") {
  const engine = ensureBlockingEngineLoaded();
  const previousRuntime = blockRuntime;
  blockRuntime = engine.advancePomodoroState(blockRuntime, blockConfig, now);
  await handlePomodoroTransitionEffects(previousRuntime, source);
  return engine.getPomodoroState(blockRuntime, blockConfig, now);
}

function sanitizeDecisionForRuntime(decision) {
  const pomodoro = decision && decision.pomodoro ? decision.pomodoro : null;
  return {
    blocked: Boolean(decision && decision.blocked),
    reason: (decision && decision.reason) || "unknown",
    activeRuleSummary: (decision && decision.activeRuleSummary) || "No decision",
    matchedPattern: (decision && decision.matchedPattern) || null,
    nextUnblockAt: (decision && decision.nextUnblockAtEpochSec) || 0,
    pomodoroPhase: pomodoro ? pomodoro.phase : null,
    pomodoroPhaseEndEpochSec: pomodoro ? pomodoro.phaseEndEpochSec : 0,
    evaluatedAt: new Date().toISOString()
  };
}

function updateBlockedTabIds(tabId, blocked) {
  if (!Number.isInteger(tabId)) return;
  const current = new Set(Array.isArray(blockRuntime.blockedTabIds) ? blockRuntime.blockedTabIds : []);
  if (blocked) {
    current.add(tabId);
  } else {
    current.delete(tabId);
  }
  blockRuntime.blockedTabIds = Array.from(current);
}

function buildBlockedPageUrl(originalUrl, decision) {
  const params = new URLSearchParams();
  params.set("u", originalUrl);
  params.set("r", decision.reason || "blocked");
  params.set("nu", String(decision.nextUnblockAtEpochSec || 0));
  return `${BLOCKED_PAGE_URL}?${params.toString()}`;
}

function isBlockedPageUrl(url) {
  return typeof url === "string" && url.startsWith(BLOCKED_PAGE_URL);
}

function decodeOriginalUrlFromBlockedPage(url) {
  if (!isBlockedPageUrl(url)) {
    return "";
  }
  try {
    const parsed = new URL(url);
    const original = parsed.searchParams.get("u");
    return original ? original.trim() : "";
  } catch {
    return "";
  }
}

async function ensureBlockingStateLoaded() {
  if (blockInitialized) {
    return;
  }

  const engine = ensureBlockingEngineLoaded();
  const stored = await getStorageLocal([BLOCK_CONFIG_KEY, BLOCK_RUNTIME_KEY]);
  const storedConfig = stored[BLOCK_CONFIG_KEY] && typeof stored[BLOCK_CONFIG_KEY] === "object"
    ? stored[BLOCK_CONFIG_KEY]
    : {};
  const hardAllowlist = defaultHardAllowlist();

  blockConfig = engine.normalizeConfig(storedConfig, hardAllowlist);
  blockRuntime = engine.normalizeRuntime(stored[BLOCK_RUNTIME_KEY]);

  const mergedAllowlist = new Set([...(blockConfig.allowlistHard || []), ...hardAllowlist]);
  blockConfig.allowlistHard = Array.from(mergedAllowlist);
  if (!storedConfig.version || Number(storedConfig.version) < 2) {
    blockConfig.pomodoroEnabled = true;
  }
  blockConfig.version = 2;
  blockConfig[BLOCK_DEBUG_KEY] = Boolean(blockConfig[BLOCK_DEBUG_KEY]);

  const now = nowEpochSec();
  blockRuntime = engine.updateRuntimeForPeriod(blockRuntime, blockConfig, now);
  blockRuntime = engine.advancePomodoroState(blockRuntime, blockConfig, now);
  blockRuntime.lastTickEpochSec = blockRuntime.lastTickEpochSec || now;

  refreshCompiledBlockers();
  await persistBlockConfig();
  await persistBlockRuntime();
  blockInitialized = true;
}

function evaluateUrlAgainstBlockRules(url, now = nowEpochSec()) {
  const engine = ensureBlockingEngineLoaded();
  const decision = engine.evaluateBlockingDecision({
    config: blockConfig,
    runtime: blockRuntime,
    compiled: blockCompiled,
    parsedRanges: blockRanges,
    url,
    now,
    extensionOrigin: chrome.runtime.getURL("")
  });
  blockRuntime = decision.runtime;
  return decision;
}

async function enforceBlockingForTab(tabId, url, source) {
  if (!Number.isInteger(tabId) || typeof url !== "string" || !url) {
    return;
  }
  if (blockEngineLoadError) {
    return;
  }

  await ensureBlockingStateLoaded();
  const previousRuntime = blockRuntime;
  const decision = evaluateUrlAgainstBlockRules(url);
  await handlePomodoroTransitionEffects(previousRuntime, `enforce:${source}`);

  blockRuntime.lastDecisionByTab = blockRuntime.lastDecisionByTab || {};
  blockRuntime.lastDecisionByTab[String(tabId)] = sanitizeDecisionForRuntime(decision);
  updateBlockedTabIds(tabId, decision.blocked);
  await persistBlockRuntime();

  if (!decision.blocked || isBlockedPageUrl(url)) {
    return;
  }

  try {
    const redirectUrl = buildBlockedPageUrl(url, decision);
    logBlock(`Blocking tab ${tabId} from ${source}`, { url, reason: decision.reason, redirectUrl });
    await chrome.tabs.update(tabId, { url: redirectUrl });
  } catch (error) {
    console.warn("[Gurt][Block] Failed to redirect blocked tab", error);
  }
}

async function restoreBlockedTabsIfPossible() {
  await ensureBlockingStateLoaded();
  const tabIds = Array.isArray(blockRuntime.blockedTabIds) ? [...blockRuntime.blockedTabIds] : [];
  for (const tabId of tabIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab || !tab.url || !isBlockedPageUrl(tab.url)) {
        updateBlockedTabIds(tabId, false);
        continue;
      }
      const originalUrl = decodeOriginalUrlFromBlockedPage(tab.url);
      if (!originalUrl) {
        updateBlockedTabIds(tabId, false);
        continue;
      }
      await chrome.tabs.update(tabId, { url: originalUrl });
      updateBlockedTabIds(tabId, false);
    } catch {
      updateBlockedTabIds(tabId, false);
    }
  }
  await persistBlockRuntime();
}

async function accrueUsageTime(now = nowEpochSec()) {
  await ensureBlockingStateLoaded();
  const engine = ensureBlockingEngineLoaded();

  const previousRuntime = blockRuntime;
  blockRuntime = engine.updateRuntimeForPeriod(blockRuntime, blockConfig, now);
  blockRuntime = engine.advancePomodoroState(blockRuntime, blockConfig, now);
  await handlePomodoroTransitionEffects(previousRuntime, "alarm-tick");
  const lastTick = Number(blockRuntime.lastTickEpochSec) || now;
  const delta = Math.max(0, now - lastTick);
  blockRuntime.lastTickEpochSec = now;

  const shouldTrackLimitUsage = blockConfig.enabled
    && Boolean(blockConfig.limitMinutes && blockConfig.limitPeriod)
    && isBrowserWindowFocused
    && Number.isInteger(activeTabIdForBlocking)
    && delta > 0;

  if (!shouldTrackLimitUsage) {
    await persistBlockRuntime();
    return;
  }

  try {
    const tab = await chrome.tabs.get(activeTabIdForBlocking);
    if (!tab || !tab.url || isBlockedPageUrl(tab.url)) {
      await persistBlockRuntime();
      return;
    }
    const decision = evaluateUrlAgainstBlockRules(tab.url, now);
    if (decision.trackable) {
      blockRuntime.usageSecondsCurrentPeriod += delta;
      logBlock("Accrued usage seconds", {
        tabId: activeTabIdForBlocking,
        delta,
        usageSecondsCurrentPeriod: blockRuntime.usageSecondsCurrentPeriod
      });
    }
  } catch {
    // Ignore transient tab lookup failures.
  }

  await persistBlockRuntime();
}

async function getActiveTabForBlockStatus() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) {
    return null;
  }
  return tabs[0];
}

async function handleGetBlockStatus() {
  await ensureBlockingStateLoaded();
  const now = nowEpochSec();
  const pomodoro = await syncPomodoroState(now, "status-check");
  const tab = await getActiveTabForBlockStatus();
  const tabId = tab && Number.isInteger(tab.id) ? tab.id : null;
  let decision = null;

  if (tab && typeof tab.url === "string" && tab.url) {
    if (isBlockedPageUrl(tab.url)) {
      decision = {
        blocked: true,
        reason: "blocked_page",
        activeRuleSummary: "Current page is the blocking notice",
        nextUnblockAtEpochSec: (() => {
          try {
            const parsed = new URL(tab.url);
            return Number(parsed.searchParams.get("nu")) || 0;
          } catch {
            return 0;
          }
        })()
      };
    } else {
      decision = evaluateUrlAgainstBlockRules(tab.url);
      if (tabId !== null) {
        blockRuntime.lastDecisionByTab[String(tabId)] = sanitizeDecisionForRuntime(decision);
      }
    }
  }

  await persistBlockRuntime();

  return {
    success: true,
    enabled: Boolean(blockConfig.enabled),
    currentlyBlocked: Boolean(decision && decision.blocked),
    reason: decision ? decision.reason : "no_active_tab",
    activeRuleSummary: decision ? decision.activeRuleSummary : "No active tab",
    nextUnblockAt: decision ? (decision.nextUnblockAtEpochSec || 0) : 0,
    tabId,
    tabUrl: tab && tab.url ? tab.url : "",
    usageSecondsCurrentPeriod: blockRuntime.usageSecondsCurrentPeriod,
    limitMinutes: blockConfig.limitMinutes,
    limitPeriod: blockConfig.limitPeriod,
    pomodoro
  };
}

async function handleGetBlockConfig() {
  await ensureBlockingStateLoaded();
  return {
    success: true,
    config: { ...blockConfig }
  };
}

async function handleSetBlockEnabled(enabled) {
  await ensureBlockingStateLoaded();
  const engine = ensureBlockingEngineLoaded();
  blockConfig.enabled = Boolean(enabled);
  blockConfig.updatedAt = new Date().toISOString();
  if (!blockConfig.enabled) {
    blockRuntime = engine.stopPomodoroSession(blockRuntime);
  }
  await persistBlockConfig();
  await persistBlockRuntime();
  if (!blockConfig.enabled) {
    await restoreBlockedTabsIfPossible();
  }
  return { success: true, enabled: blockConfig.enabled };
}

async function handleSetPomodoroActive(active) {
  await ensureBlockingStateLoaded();
  const engine = ensureBlockingEngineLoaded();
  const shouldActivate = Boolean(active);

  if (!blockConfig.enabled) {
    return {
      success: false,
      error: "Enable focus blocking before starting Pomodoro."
    };
  }

  if (!blockConfig.pomodoroEnabled) {
    return {
      success: false,
      error: "Pomodoro is disabled in settings."
    };
  }

  if (!shouldActivate) {
    if (blockRuntime.pomodoroActive) {
      return {
        success: false,
        error: "Pomodoro session cannot be stopped manually before it ends."
      };
    }
    return {
      success: true,
      pomodoro: getPomodoroSnapshot()
    };
  }

  if (!blockRuntime.pomodoroActive) {
    blockRuntime = engine.startPomodoroSession(blockRuntime, blockConfig, nowEpochSec());
  }

  await persistBlockRuntime();

  const activeTab = await getActiveTabForBlockStatus();
  if (activeTab && Number.isInteger(activeTab.id) && typeof activeTab.url === "string") {
    await enforceBlockingForTab(activeTab.id, activeTab.url, "pomodoro-start");
  }

  return {
    success: true,
    pomodoro: getPomodoroSnapshot()
  };
}

async function handleSaveBlockConfig(payload) {
  await ensureBlockingStateLoaded();
  const engine = ensureBlockingEngineLoaded();
  const incoming = payload && typeof payload === "object" ? payload : {};
  const candidate = {
    ...blockConfig,
    ...incoming,
    allowlistHard: Array.from(new Set([...(incoming.allowlistHard || []), ...defaultHardAllowlist()])),
    updatedAt: new Date().toISOString()
  };

  const validation = engine.validateConfig(candidate);
  if (!validation.valid) {
    return { success: false, validationErrors: validation.errors };
  }

  blockConfig = engine.normalizeConfig(validation.normalized, defaultHardAllowlist());
  blockConfig[BLOCK_DEBUG_KEY] = Boolean(candidate[BLOCK_DEBUG_KEY]);
  const previousRuntime = blockRuntime;
  blockRuntime = engine.updateRuntimeForPeriod(blockRuntime, blockConfig, nowEpochSec());
  blockRuntime = engine.advancePomodoroState(blockRuntime, blockConfig, nowEpochSec());
  if (!blockConfig.pomodoroEnabled) {
    blockRuntime = engine.stopPomodoroSession(blockRuntime);
  }
  await handlePomodoroTransitionEffects(previousRuntime, "save-config");
  refreshCompiledBlockers();

  await persistBlockConfig();
  await persistBlockRuntime();

  return {
    success: true,
    validationErrors: [],
    config: { ...blockConfig }
  };
}

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
    void enforceBlockingForTab(tabId, changeInfo.url, "tabs.onUpdated:url");
  }

  if (changeInfo.status === "complete" && tab && typeof tab.url === "string") {
    void enforceBlockingForTab(tabId, tab.url, "tabs.onUpdated:complete");
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  activeTabIdForBlocking = activeInfo.tabId;
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      notifyCourseChange(tab.id, tab.url);
      await enforceBlockingForTab(tab.id, tab.url, "tabs.onActivated");
    }
  } catch { /* tab may not be accessible */ }
});

if (chrome.webNavigation && chrome.webNavigation.onBeforeNavigate) {
  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (!details || details.frameId !== 0 || typeof details.tabId !== "number") {
      return;
    }
    if (typeof details.url !== "string" || !details.url) {
      return;
    }
    void enforceBlockingForTab(details.tabId, details.url, "webNavigation.onBeforeNavigate");
  });
}

if (chrome.windows && chrome.windows.onFocusChanged) {
  chrome.windows.onFocusChanged.addListener((windowId) => {
    isBrowserWindowFocused = windowId !== chrome.windows.WINDOW_ID_NONE;
  });
}

if (chrome.alarms) {
  chrome.alarms.create(BLOCK_TICK_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm || alarm.name !== BLOCK_TICK_ALARM) {
      return;
    }
    void accrueUsageTime();
  });
}

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

  if (message.type === "GET_BLOCK_STATUS") {
    handleGetBlockStatus().then(sendResponse).catch((error) => {
      sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === "GET_BLOCK_CONFIG") {
    handleGetBlockConfig().then(sendResponse).catch((error) => {
      sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === "SET_BLOCK_ENABLED") {
    handleSetBlockEnabled(Boolean(message.enabled)).then(sendResponse).catch((error) => {
      sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === "SET_POMODORO_ACTIVE") {
    handleSetPomodoroActive(Boolean(message.active)).then(sendResponse).catch((error) => {
      sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === "SAVE_BLOCK_CONFIG") {
    handleSaveBlockConfig(message.config || {}).then(sendResponse).catch((error) => {
      sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
    });
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

    return {
      success: true,
      answer: (data && (data.answer || data.message)) || JSON.stringify(data),
      action: (data && data.action) || null,
      citations: data && Array.isArray(data.citations) ? data.citations : [],
      citationDetails: data && Array.isArray(data.citationDetails) ? data.citationDetails : []
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleGenerateStudyTool(action, courseId, courseName) {
  try {
    let data;

    if (action.type === "flashcards") {
      const rawMaterialIds = Array.isArray(action.materialIds) ? action.materialIds : [];
      const normalizedMaterialIds = [];
      const seenMaterialIds = new Set();
      for (const materialId of rawMaterialIds) {
        if (typeof materialId !== "string") {
          continue;
        }
        const trimmed = materialId.trim();
        if (!trimmed || seenMaterialIds.has(trimmed)) {
          continue;
        }
        seenMaterialIds.add(trimmed);
        normalizedMaterialIds.push(trimmed);
        if (normalizedMaterialIds.length >= MAX_FLASHCARD_MATERIAL_IDS) {
          break;
        }
      }

      // --- Async: start generation job ---
      const startResponse = await fetch(`${API_BASE_URL}/generate/flashcards-from-materials/jobs`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          courseId: courseId,
          materialIds: normalizedMaterialIds,
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
        resourceLabels: Array.isArray(action.materialNames)
          ? action.materialNames.slice(0, normalizedMaterialIds.length)
          : [],
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
