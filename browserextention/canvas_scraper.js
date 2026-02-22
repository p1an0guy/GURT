const MODULE_CONTAINER_SELECTORS = [
  "#context_modules .context_module",
  "#context_modules [id^='context_module_']",
  "#context_modules .module",
  ".context_module"
];

const MODULE_ITEM_SELECTORS = [
  "li.context_module_item",
  "li.module-item",
  ".module-item",
  ".ig-row",
  "li[class*='context_module_item']",
  ".context_module_item"
];

const COLLAPSED_MODULE_CLASSES = [
  "collapsed_module",
  "context_module_collapsed"
];

const FETCHABLE_SOURCE_TYPES = {
  assignment: "assignment_attachment",
  page: "page_attachment",
  discussion: "discussion_attachment",
  module_item: "module_item_attachment",
  modules: "modules_page",
  quiz: "quiz_page",
  files_index: "files_index_page"
};

const NOISE_QUERY_PARAMS = new Set([
  "download_frd",
  "module_item_id",
  "module_id",
  "verifier",
  "wrap"
]);

const DEFAULT_MAX_CRAWL_DEPTH = 3;
const DEFAULT_MAX_SOURCE_PAGES = 60;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
}

function safeUrl(rawUrl, baseUrl = window.location.href) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return null;
  }

  try {
    const url = new URL(rawUrl, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function normalizeUrl(rawUrl, baseUrl = window.location.href) {
  const url = safeUrl(rawUrl, baseUrl);
  if (!url) {
    return null;
  }

  url.hash = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  return url.toString();
}

function isCanvasUserContentHost(hostname) {
  return /(^|\.)canvas-user-content\.com$/i.test(String(hostname || ""));
}

function isAllowedDownloadOrigin(urlObject) {
  if (!urlObject) {
    return false;
  }
  return (
    urlObject.origin === window.location.origin ||
    isCanvasUserContentHost(urlObject.hostname)
  );
}

function isInCourseScope(urlObject, expectedCourseId) {
  if (!urlObject) {
    return false;
  }
  const normalizedExpected = normalizeWhitespace(expectedCourseId);
  if (!normalizedExpected) {
    return true;
  }
  const linkCourseId = extractCourseId(urlObject.toString());
  if (!linkCourseId) {
    return true;
  }
  return linkCourseId === normalizedExpected;
}

function parseCanvasFileId(rawValue) {
  const candidate = normalizeWhitespace(String(rawValue || "").toLowerCase());
  if (!candidate) {
    return "";
  }
  if (/^\d+$/.test(candidate)) {
    return candidate;
  }
  if (/^\d+~\d+$/.test(candidate)) {
    return candidate;
  }
  return "";
}

function canonicalizeUrlForDedupe(rawUrl) {
  const url = safeUrl(rawUrl);
  if (!url) {
    return "";
  }

  url.hash = "";
  const filteredParams = [...url.searchParams.entries()]
    .filter(([key]) => !NOISE_QUERY_PARAMS.has(key))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  filteredParams.forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

function extractFileId(rawUrl) {
  const url = safeUrl(rawUrl);
  if (!url) {
    return null;
  }
  const match = url.pathname.match(/\/files\/([^/]+)(?:\/|$)/i);
  if (!match || !match[1]) {
    return null;
  }
  let decoded = match[1];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep original segment when decode fails.
  }
  const parsed = parseCanvasFileId(decoded);
  return parsed || null;
}

function extractCourseId(rawUrl) {
  const url = safeUrl(rawUrl);
  if (!url) {
    return "";
  }
  const match = url.pathname.match(/\/courses\/([^/?#]+)/i);
  if (!match || !match[1]) {
    return "";
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function buildCourseFileDownloadUrl(courseId, fileId, baseUrl) {
  const normalizedCourseId = typeof courseId === "string" ? courseId.trim() : "";
  const normalizedFileId = typeof fileId === "string" ? fileId.trim() : String(fileId || "").trim();
  if (!normalizedCourseId || !normalizedFileId) {
    return null;
  }

  const encodedCourseId = encodeURIComponent(normalizedCourseId);
  const encodedFileId = encodeURIComponent(normalizedFileId);
  return (
    normalizeUrl(
      `/courses/${encodedCourseId}/files/${encodedFileId}/download?download_frd=1`,
      baseUrl
    ) ||
    normalizeUrl(`/courses/${encodedCourseId}/files/${encodedFileId}`, baseUrl)
  );
}

function fileDedupeKey(rawUrl) {
  const fileId = extractFileId(rawUrl);
  if (fileId) {
    return `file:${fileId}`;
  }
  return `url:${canonicalizeUrlForDedupe(rawUrl)}`;
}

function getFileNameFromUrl(rawUrl) {
  const url = safeUrl(rawUrl);
  if (!url) {
    return "";
  }
  const segment = url.pathname.split("/").pop() || "";
  if (!segment) {
    return "";
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function inferExtension(fileUrl, title) {
  const fromUrl = getFileNameFromUrl(fileUrl).match(/\.([a-z0-9]{1,8})$/i);
  if (fromUrl) {
    return fromUrl[1].toLowerCase();
  }

  const normalizedTitle = normalizeWhitespace(title);
  const fromTitle = normalizedTitle.match(/\.([a-z0-9]{1,8})$/i);
  if (fromTitle) {
    return fromTitle[1].toLowerCase();
  }

  return "";
}

function emitProgress(onProgress, payload) {
  if (typeof onProgress !== "function") {
    return;
  }

  try {
    onProgress({
      timestamp: new Date().toISOString(),
      ...payload
    });
  } catch {
    // Progress updates are best-effort only.
  }
}

function uniqueElements(elements) {
  const unique = [];
  const seen = new Set();

  elements.forEach((element) => {
    if (!element || seen.has(element)) {
      return;
    }
    seen.add(element);
    unique.push(element);
  });

  return unique;
}

function findModuleContainers() {
  const candidates = MODULE_CONTAINER_SELECTORS.flatMap((selector) =>
    [...document.querySelectorAll(selector)]
  );
  const unique = uniqueElements(candidates);
  if (unique.length > 0) {
    return unique;
  }

  const root = document.querySelector("#context_modules");
  if (!root) {
    return unique;
  }

  const fallbackModules = [
    ...root.querySelectorAll("article, section, div[class*='module'], div[id*='module']")
  ];
  return uniqueElements(fallbackModules);
}

async function waitForModules(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (findModuleContainers().length > 0) {
      return;
    }
    await wait(200);
  }
}

function moduleIsCollapsed(moduleElement) {
  if (!moduleElement) {
    return false;
  }

  if (COLLAPSED_MODULE_CLASSES.some((className) => moduleElement.classList.contains(className))) {
    return true;
  }

  const expandedToggle = moduleElement.querySelector("[aria-expanded]");
  if (expandedToggle && expandedToggle.getAttribute("aria-expanded") === "false") {
    return true;
  }

  const content = moduleElement.querySelector(".content, .items, .module_items, ul");
  if (!content) {
    return false;
  }

  if (content.hidden || content.getAttribute("aria-hidden") === "true") {
    return true;
  }

  const style = window.getComputedStyle(content);
  return style.display === "none" || style.visibility === "hidden";
}

function findModuleToggle(moduleElement) {
  const selectors = [
    "button[aria-expanded]",
    "[role='button'][aria-expanded]",
    ".expand_module_link",
    ".collapse_module_link",
    ".header button",
    ".ig-header button"
  ];

  for (const selector of selectors) {
    const element = moduleElement.querySelector(selector);
    if (element) {
      return element;
    }
  }

  return null;
}

async function expandCollapsedModules(onProgress) {
  let expandedCount = 0;

  for (let pass = 1; pass <= 3; pass += 1) {
    const modules = findModuleContainers();
    const collapsed = modules.filter(moduleIsCollapsed);

    emitProgress(onProgress, {
      stage: "expand_modules",
      message: `Expand pass ${pass}: ${collapsed.length} collapsed module(s) found.`,
      pass,
      moduleCount: modules.length,
      collapsedCount: collapsed.length,
      expandedCount
    });

    if (collapsed.length === 0) {
      break;
    }

    let expandedThisPass = 0;
    for (const moduleElement of collapsed) {
      const toggle = findModuleToggle(moduleElement);
      if (!toggle) {
        continue;
      }

      toggle.click();
      await wait(120);
      if (!moduleIsCollapsed(moduleElement)) {
        expandedCount += 1;
        expandedThisPass += 1;
      }
    }

    await wait(200);
    if (expandedThisPass === 0) {
      break;
    }
  }

  return expandedCount;
}

function getModuleName(moduleElement, moduleIndex) {
  const selectors = [
    ".name",
    ".ig-header-title",
    ".module-name",
    ".header h2",
    "h2"
  ];

  for (const selector of selectors) {
    const element = moduleElement.querySelector(selector);
    const name = normalizeWhitespace(element ? element.textContent : "");
    if (name) {
      return name;
    }
  }

  return `Module ${moduleIndex + 1}`;
}

function findModuleItems(moduleElement) {
  const items = MODULE_ITEM_SELECTORS.flatMap((selector) =>
    [...moduleElement.querySelectorAll(selector)]
  );
  const uniqueItems = uniqueElements(items);
  if (uniqueItems.length > 0) {
    return uniqueItems;
  }

  return uniqueElements([...moduleElement.querySelectorAll("li")]);
}

function isIgnoredLink(anchor) {
  const href = anchor.getAttribute("href");
  if (!href) {
    return true;
  }

  const normalizedHref = href.trim().toLowerCase();
  if (
    normalizedHref.startsWith("#") ||
    normalizedHref.startsWith("javascript:") ||
    normalizedHref.startsWith("mailto:") ||
    normalizedHref.startsWith("tel:")
  ) {
    return true;
  }

  const className = `${anchor.className || ""}`.toLowerCase();
  return (
    className.includes("expand") ||
    className.includes("collapse") ||
    className.includes("al-trigger") ||
    className.includes("icon")
  );
}

function scoreLink(anchor) {
  let score = 0;
  const href = anchor.getAttribute("href") || "";
  const className = `${anchor.className || ""}`.toLowerCase();
  const text = normalizeWhitespace(anchor.textContent || "");

  if (className.includes("ig-title") || className.includes("item_link")) {
    score += 10;
  }
  if (href.includes("/courses/")) {
    score += 4;
  }
  if (text.length > 0) {
    score += 2;
  }
  if (className.includes("icon")) {
    score -= 3;
  }

  return score;
}

function findPrimaryItemLink(moduleItemElement) {
  const links = [...moduleItemElement.querySelectorAll("a[href]")].filter(
    (anchor) => !isIgnoredLink(anchor)
  );
  if (links.length === 0) {
    return null;
  }

  links.sort((left, right) => scoreLink(right) - scoreLink(left));
  return links[0];
}

function findCandidateItemLinks(moduleItemElement) {
  const links = [...moduleItemElement.querySelectorAll("a[href]")].filter(
    (anchor) => !isIgnoredLink(anchor)
  );
  if (links.length === 0) {
    const primary = findPrimaryItemLink(moduleItemElement);
    return primary ? [primary] : [];
  }
  return links;
}

function readModuleItemType(moduleItemElement) {
  const dataType = normalizeWhitespace(
    moduleItemElement.getAttribute("data-item-type") || moduleItemElement.dataset?.itemType || ""
  ).toLowerCase();
  if (dataType) {
    return dataType;
  }

  const hiddenType = normalizeWhitespace(
    moduleItemElement.querySelector(".module_item_icons .type, .ig-info .type, .type")?.textContent || ""
  ).toLowerCase();
  if (hiddenType) {
    return hiddenType;
  }

  const className = `${moduleItemElement.className || ""}`.toLowerCase();
  if (className.includes("attachment")) {
    return "attachment";
  }
  if (className.includes("assignment")) {
    return "assignment";
  }
  if (className.includes("wiki_page") || className.includes("page")) {
    return "page";
  }
  if (className.includes("discussion")) {
    return "discussion";
  }

  return "";
}

function readAttachmentFileId(moduleItemElement) {
  const className = `${moduleItemElement.className || ""}`;
  const requirementMatch = className.match(/\bAttachment_(\d+)\b/i);
  if (requirementMatch && requirementMatch[1]) {
    return requirementMatch[1];
  }

  const dataContentId =
    normalizeWhitespace(moduleItemElement.getAttribute("data-content-id") || "") ||
    normalizeWhitespace(moduleItemElement.dataset?.contentId || "");
  if (/^\d+$/.test(dataContentId)) {
    return dataContentId;
  }

  return null;
}

function createAttachmentRecordFromModuleItem(moduleItemElement, { moduleName, startUrl, courseId }) {
  const fileId = readAttachmentFileId(moduleItemElement);
  if (!fileId) {
    return null;
  }

  const fileUrl =
    buildCourseFileDownloadUrl(courseId, fileId, startUrl) ||
    normalizeUrl(`/files/${encodeURIComponent(fileId)}`, startUrl);
  if (!fileUrl) {
    return null;
  }

  const primaryLink = findPrimaryItemLink(moduleItemElement);
  const sourceUrl =
    normalizeUrl(primaryLink ? primaryLink.getAttribute("href") : "", startUrl) || startUrl;
  const title = primaryLink
    ? extractLinkTitle(primaryLink, fileUrl)
    : `Attachment ${fileId}`;

  return createRecord({
    sourceUrl,
    fileUrl,
    title,
    moduleName,
    sourceType: "module_file"
  });
}

function classifyModuleItem(urlObject, moduleItemElement) {
  const path = urlObject.pathname.toLowerCase();
  if (isCanvasFileLink(urlObject)) {
    return "module_file";
  }
  if (/\/courses\/[^/]+\/modules\/items\/\d+(?:\/|$)/.test(path)) {
    return "module_item";
  }
  if (/\/courses\/[^/]+\/modules(?:\/|$)/.test(path)) {
    return "modules";
  }
  if (path.includes("/assignments/")) {
    return "assignment";
  }
  if (path.includes("/pages/")) {
    return "page";
  }
  if (path.includes("/discussion_topics/")) {
    return "discussion";
  }

  const itemType =
    (moduleItemElement.getAttribute("data-item-type") || moduleItemElement.dataset?.itemType || "")
      .toLowerCase()
      .trim();
  if (itemType === "file") {
    return "module_file";
  }
  if (itemType === "attachment") {
    return "module_file";
  }
  if (itemType === "assignment") {
    return "assignment";
  }
  if (itemType.includes("discussion")) {
    return "discussion";
  }
  if (itemType === "page" || itemType.includes("wiki")) {
    return "page";
  }

  const className = `${moduleItemElement.className || ""}`.toLowerCase();
  if (className.includes("file")) {
    return "module_file";
  }
  if (className.includes("attachment")) {
    return "module_file";
  }
  if (className.includes("assignment")) {
    return "assignment";
  }
  if (className.includes("wiki_page") || className.includes("page")) {
    return "page";
  }
  if (className.includes("discussion")) {
    return "discussion";
  }

  return "other";
}

function classifyLinkByPath(urlObject) {
  if (!urlObject) {
    return "other";
  }
  const path = urlObject.pathname.toLowerCase();
  if (isCanvasFileLink(urlObject)) {
    return "module_file";
  }
  if (/\/courses\/[^/]+\/modules\/items\/\d+(?:\/|$)/.test(path)) {
    return "module_item";
  }
  if (/\/courses\/[^/]+\/modules(?:\/|$)/.test(path)) {
    return "modules";
  }
  if (/\/courses\/[^/]+\/wiki(?:\/|$)/.test(path)) {
    return "page";
  }
  if (path.includes("/syllabus")) {
    return "page";
  }
  if (path.includes("/assignments/")) {
    return "assignment";
  }
  if (path.includes("/pages/")) {
    return "page";
  }
  if (path.includes("/discussion_topics/")) {
    return "discussion";
  }
  if (path.includes("/announcements")) {
    return "discussion";
  }
  if (path.includes("/quizzes/")) {
    return "quiz";
  }
  if (/\/courses\/[^/]+\/files(?:\/|$)/.test(path)) {
    return "files_index";
  }
  return "other";
}

function extractFileIdFromApiEndpoint(value) {
  if (!value) {
    return null;
  }
  const match = value.match(/\/files\/([0-9~]+)(?:\/|$|[?#])/i);
  if (!match || !match[1]) {
    return null;
  }
  const parsed = parseCanvasFileId(match[1]);
  return parsed || null;
}

function isCanvasFileLink(urlObject) {
  return Boolean(extractFileId(urlObject.toString()));
}

function createRecord({ sourceUrl, fileUrl, title, moduleName, sourceType }) {
  const normalizedSourceUrl = normalizeUrl(sourceUrl);
  const normalizedFileUrl = normalizeUrl(fileUrl, normalizedSourceUrl || window.location.href);
  if (!normalizedSourceUrl || !normalizedFileUrl) {
    return null;
  }

  const normalizedTitle = normalizeWhitespace(title) || getFileNameFromUrl(normalizedFileUrl) || "Untitled";
  return {
    sourceUrl: normalizedSourceUrl,
    fileUrl: normalizedFileUrl,
    title: normalizedTitle,
    moduleName: normalizeWhitespace(moduleName) || "Untitled Module",
    sourceType,
    extension: inferExtension(normalizedFileUrl, normalizedTitle)
  };
}

function dedupeRecords(records) {
  const deduped = [];
  const seen = new Set();

  for (const record of records) {
    if (!record) {
      continue;
    }
    const key = [
      canonicalizeUrlForDedupe(record.sourceUrl),
      fileDedupeKey(record.fileUrl),
      record.sourceType,
      record.moduleName
    ].join("|");

    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }

  return deduped;
}

function dedupeFetchTargets(targets) {
  const deduped = [];
  const seen = new Set();

  for (const target of targets) {
    const sourceUrl = normalizeUrl(target && target.sourceUrl ? target.sourceUrl : "");
    if (!sourceUrl) {
      continue;
    }
    const key = canonicalizeUrlForDedupe(sourceUrl);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      sourceUrl,
      moduleName: normalizeWhitespace(target && target.moduleName ? target.moduleName : "") || "Course Content",
      sourceType: normalizeWhitespace(target && target.sourceType ? target.sourceType : "") || "linked_page",
      depth: Math.max(1, Number(target && target.depth ? target.depth : 1) || 1)
    });
  }

  return deduped;
}

function buildFetchTarget(target, depth = 1) {
  const sourceUrl = normalizeUrl(target && target.sourceUrl ? target.sourceUrl : "");
  if (!sourceUrl) {
    return null;
  }
  return {
    sourceUrl,
    moduleName: normalizeWhitespace(target && target.moduleName ? target.moduleName : "") || "Course Content",
    sourceType: normalizeWhitespace(target && target.sourceType ? target.sourceType : "") || "linked_page",
    depth: Math.max(1, Number(depth) || 1)
  };
}

function deriveFallbackModuleName() {
  const heading = normalizeWhitespace(
    document.querySelector("#content h1, [role='main'] h1, .assignment-title h2, h1")?.textContent || ""
  );
  if (heading) {
    return heading;
  }
  return normalizeWhitespace(document.title) || "Course Content";
}

function findLooseModuleRoot() {
  const mainContent = document.querySelector("#content, #main, [role='main']");
  if (mainContent) {
    return mainContent;
  }
  return document.querySelector("#context_modules") || document.body;
}

function scanLooseAnchors(root, startUrl, options = {}) {
  const courseId = normalizeWhitespace(options.courseId || extractCourseId(startUrl || window.location.href));
  const fallbackModuleName = normalizeWhitespace(options.defaultModuleName) || "Course Content";
  const directRecords = [];
  const fetchTargets = [];
  const anchors = [...root.querySelectorAll("a[href], a[data-api-endpoint]")].filter((a) => !isIgnoredLink(a));

  for (const anchor of anchors) {
    let normalizedLinkUrl = normalizeUrl(anchor.getAttribute("href"), startUrl || window.location.href);
    let linkUrlObject = safeUrl(normalizedLinkUrl);

    if (!linkUrlObject || !isCanvasFileLink(linkUrlObject)) {
      const apiEndpoint = anchor.getAttribute("data-api-endpoint") || "";
      const fileId = extractFileIdFromApiEndpoint(apiEndpoint);
      if (fileId) {
        const courseDownloadUrl = courseId
          ? buildCourseFileDownloadUrl(courseId, fileId, startUrl || window.location.href)
          : null;
        normalizedLinkUrl =
          courseDownloadUrl ||
          normalizeUrl(`/files/${encodeURIComponent(fileId)}`, startUrl || window.location.href);
        linkUrlObject = safeUrl(normalizedLinkUrl);
      }
    }

    const moduleContainer = anchor.closest(".context_module, [id^='context_module_'], .module");
    const moduleName = moduleContainer ? getModuleName(moduleContainer, 0) : fallbackModuleName;
    const title = extractLinkTitle(anchor, normalizedLinkUrl || "");

    if (
      linkUrlObject &&
      isCanvasFileLink(linkUrlObject) &&
      isAllowedDownloadOrigin(linkUrlObject) &&
      isInCourseScope(linkUrlObject, courseId)
    ) {
      const record = createRecord({
        sourceUrl: startUrl || window.location.href,
        fileUrl: normalizedLinkUrl,
        title,
        moduleName,
        sourceType: "module_file"
      });
      if (record) {
        directRecords.push(record);
      }
      continue;
    }

    if (
      !linkUrlObject ||
      linkUrlObject.origin !== window.location.origin ||
      !isInCourseScope(linkUrlObject, courseId)
    ) {
      continue;
    }

    const type = classifyLinkByPath(linkUrlObject);
    if (!FETCHABLE_SOURCE_TYPES[type]) {
      continue;
    }

    if (canonicalizeUrlForDedupe(linkUrlObject.toString()) === canonicalizeUrlForDedupe(startUrl)) {
      continue;
    }

    fetchTargets.push({
      sourceUrl: normalizedLinkUrl,
      moduleName,
      sourceType: FETCHABLE_SOURCE_TYPES[type]
    });
  }

  return { directRecords, fetchTargets };
}

async function fetchAttachmentsFromSource(target, crawlOptions = {}) {
  const response = await fetch(target.sourceUrl, {
    method: "GET",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch source (${response.status})`);
  }

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const pageScan = scanLooseAnchors(doc, target.sourceUrl, {
    courseId: crawlOptions.courseId,
    defaultModuleName: target.moduleName
  });

  const maxDepth = Math.max(1, Number(crawlOptions.maxDepth) || DEFAULT_MAX_CRAWL_DEPTH);
  const shouldEnqueueMore = target.depth < maxDepth;

  const nextTargets = shouldEnqueueMore
    ? pageScan.fetchTargets
        .map((candidate) =>
          buildFetchTarget(
            {
              sourceUrl: candidate.sourceUrl,
              moduleName: target.moduleName,
              sourceType: candidate.sourceType
            },
            target.depth + 1
          )
        )
        .filter(Boolean)
    : [];

  return {
    directRecords: pageScan.directRecords,
    nextTargets
  };
}

function isModulesPage(pathname) {
  return /\/courses\/[^/]+\/modules(?:\/|$)/.test(pathname);
}

function extractLinkTitle(anchor, fallbackUrl) {
  const title = normalizeWhitespace(anchor.textContent || anchor.getAttribute("title") || "");
  if (title) {
    return title;
  }
  return getFileNameFromUrl(fallbackUrl);
}

async function fetchTargetsWithConcurrency(targets, onProgress, options = {}) {
  if (targets.length === 0) {
    return [];
  }

  const concurrency = Math.min(
    Math.max(1, Number(options.concurrency) || 3),
    Math.max(1, targets.length)
  );
  const maxDepth = Math.max(1, Number(options.maxDepth) || DEFAULT_MAX_CRAWL_DEPTH);
  const maxSources = Math.max(1, Number(options.maxSources) || DEFAULT_MAX_SOURCE_PAGES);

  const output = [];
  const queue = [];
  const seenSources = new Set();
  let completed = 0;

  function enqueue(target) {
    const normalized = buildFetchTarget(target, target && target.depth ? target.depth : 1);
    if (!normalized) {
      return false;
    }
    if (normalized.depth > maxDepth) {
      return false;
    }
    const key = canonicalizeUrlForDedupe(normalized.sourceUrl);
    if (!key || seenSources.has(key)) {
      return false;
    }
    if (seenSources.size >= maxSources) {
      return false;
    }
    seenSources.add(key);
    queue.push(normalized);
    return true;
  }

  targets.forEach((target) => enqueue(target));
  const totalSources = () => seenSources.size;

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const target = queue.shift();
      if (!target) {
        continue;
      }

      emitProgress(onProgress, {
        stage: "fetch_source_start",
        message: `Fetching ${target.sourceUrl}`,
        sourceUrl: target.sourceUrl,
        moduleName: target.moduleName,
        sourceType: target.sourceType,
        depth: target.depth,
        completedSources: completed,
        totalSources: totalSources()
      });

      try {
        const discovered = await fetchAttachmentsFromSource(target, {
          courseId: options.courseId,
          maxDepth
        });
        output.push(...discovered.directRecords);
        let queuedSources = 0;
        discovered.nextTargets.forEach((nextTarget) => {
          if (enqueue(nextTarget)) {
            queuedSources += 1;
          }
        });

        emitProgress(onProgress, {
          stage: "fetch_source_success",
          message: `Found ${discovered.directRecords.length} attachment(s) in source.`,
          sourceUrl: target.sourceUrl,
          moduleName: target.moduleName,
          sourceType: target.sourceType,
          depth: target.depth,
          foundInSource: discovered.directRecords.length,
          queuedSources
        });
      } catch (error) {
        emitProgress(onProgress, {
          stage: "fetch_source_error",
          message: error instanceof Error ? error.message : String(error),
          sourceUrl: target.sourceUrl,
          moduleName: target.moduleName,
          sourceType: target.sourceType,
          depth: target.depth
        });
      } finally {
        completed += 1;
        emitProgress(onProgress, {
          stage: "fetch_progress",
          message: `Fetched ${completed}/${totalSources()} linked source page(s).`,
          completedSources: completed,
          totalSources: totalSources()
        });
      }
    }
  });

  await Promise.all(workers);
  return output;
}

async function scrapeCanvasModules(options = {}) {
  const onProgress = options.onProgress;
  const startUrl = normalizeUrl(options.sourceUrl || window.location.href, window.location.href);
  const courseId = extractCourseId(startUrl || window.location.href);
  const runningOnModulesPage = isModulesPage(window.location.pathname);
  const fallbackModuleName = deriveFallbackModuleName();

  emitProgress(onProgress, {
    stage: "start",
    message: runningOnModulesPage
      ? "Starting Canvas module discovery."
      : "Starting Canvas page discovery.",
    sourceUrl: startUrl
  });

  const directRecords = [];
  const fetchTargets = [];
  let expandedCount = 0;
  let modules = [];

  if (runningOnModulesPage) {
    await waitForModules();
    expandedCount = await expandCollapsedModules(onProgress);

    modules = findModuleContainers();

    emitProgress(onProgress, {
      stage: "scan_modules_start",
      message: `Scanning ${modules.length} module(s) for links.`,
      moduleCount: modules.length,
      expandedCount
    });

    modules.forEach((moduleElement, moduleIndex) => {
      const moduleName = getModuleName(moduleElement, moduleIndex);
      const moduleItems = findModuleItems(moduleElement);

      emitProgress(onProgress, {
        stage: "scan_module",
        message: `Scanning ${moduleName} (${moduleItems.length} item(s)).`,
        moduleName,
        moduleIndex: moduleIndex + 1,
        moduleCount: modules.length,
        itemCount: moduleItems.length
      });

      moduleItems.forEach((moduleItem) => {
        const moduleItemType = readModuleItemType(moduleItem);
        if (moduleItemType === "attachment") {
          const attachmentRecord = createAttachmentRecordFromModuleItem(moduleItem, {
            moduleName,
            startUrl,
            courseId
          });
          if (attachmentRecord) {
            directRecords.push(attachmentRecord);
            return;
          }
        }

        const links = findCandidateItemLinks(moduleItem);
        links.forEach((link) => {
          const normalizedLinkUrl = normalizeUrl(link.getAttribute("href"), startUrl || window.location.href);
          const linkUrlObject = safeUrl(normalizedLinkUrl);
          if (!normalizedLinkUrl || !linkUrlObject) {
            return;
          }

          if (!isInCourseScope(linkUrlObject, courseId)) {
            return;
          }

          const title = extractLinkTitle(link, normalizedLinkUrl);
          if (isCanvasFileLink(linkUrlObject) && isAllowedDownloadOrigin(linkUrlObject)) {
            const record = createRecord({
              sourceUrl: startUrl || window.location.href,
              fileUrl: normalizedLinkUrl,
              title,
              moduleName,
              sourceType: "module_file"
            });
            if (record) {
              directRecords.push(record);
            }
            return;
          }

          if (linkUrlObject.origin !== window.location.origin) {
            return;
          }

          const itemType = classifyModuleItem(linkUrlObject, moduleItem);
          if (itemType === "module_file") {
            const record = createRecord({
              sourceUrl: startUrl || window.location.href,
              fileUrl: normalizedLinkUrl,
              title,
              moduleName,
              sourceType: "module_file"
            });
            if (record) {
              directRecords.push(record);
            }
            return;
          }

          if (FETCHABLE_SOURCE_TYPES[itemType]) {
            fetchTargets.push({
              sourceUrl: normalizedLinkUrl,
              moduleName,
              sourceType: FETCHABLE_SOURCE_TYPES[itemType]
            });
          }
        });
      });
    });
  }

  if (directRecords.length === 0 && fetchTargets.length === 0) {
    const looseRoot = findLooseModuleRoot();
    const looseScan = scanLooseAnchors(looseRoot, startUrl, {
      courseId,
      defaultModuleName: fallbackModuleName
    });
    directRecords.push(...looseScan.directRecords);
    fetchTargets.push(...looseScan.fetchTargets);
    emitProgress(onProgress, {
      stage: "loose_scan",
      message: `Fallback scan found ${looseScan.directRecords.length} direct and ${looseScan.fetchTargets.length} linked source(s).`,
      directCount: looseScan.directRecords.length,
      linkedSourceCount: looseScan.fetchTargets.length
    });
  }

  const uniqueFetchTargets = dedupeFetchTargets(fetchTargets);

  emitProgress(onProgress, {
    stage: runningOnModulesPage ? "scan_modules_complete" : "scan_page_complete",
    message: `Found ${directRecords.length} direct file link(s) and ${uniqueFetchTargets.length} linked source page(s).`,
    directCount: directRecords.length,
    linkedSourceCount: uniqueFetchTargets.length
  });

  const fetchedRecords = await fetchTargetsWithConcurrency(uniqueFetchTargets, onProgress, {
    concurrency: options.concurrency || 3,
    maxDepth: options.maxDepth || DEFAULT_MAX_CRAWL_DEPTH,
    maxSources: options.maxSources || DEFAULT_MAX_SOURCE_PAGES,
    courseId
  });

  const discovered = dedupeRecords([...directRecords, ...fetchedRecords]);
  emitProgress(onProgress, {
    stage: "complete",
    message: `Discovery complete with ${discovered.length} unique file record(s).`,
    discoveredCount: discovered.length,
    directCount: directRecords.length,
    attachmentCount: fetchedRecords.length
  });

  return discovered;
}

const api = { scrapeCanvasModules };

if (typeof globalThis !== "undefined") {
  globalThis.GurtCanvasScraper = api;
}

export { scrapeCanvasModules };
export default api;
