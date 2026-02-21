(() => {
  const bootKey = "__GURT_CONTENT_SCRIPT_BOOTSTRAPPED__";
  if (globalThis[bootKey]) {
    return;
  }
  globalThis[bootKey] = true;

// Extract contextual information from the current Canvas page
function extractPageContext() {
  const context = {
    url: window.location.href,
    pageTitle: document.title
  };

  // Course name from breadcrumbs
  const breadcrumbs = document.querySelectorAll("#breadcrumbs li a span");
  if (breadcrumbs.length > 0) {
    // The second breadcrumb is typically the course name
    context.courseName = breadcrumbs.length > 1
      ? breadcrumbs[1].textContent.trim()
      : breadcrumbs[0].textContent.trim();
  }

  // Extract course ID from URL (e.g. /courses/12345/...)
  const path = window.location.pathname;
  const courseMatch = path.match(/\/courses\/(\d+)/);
  if (courseMatch) {
    context.courseId = courseMatch[1];
  }

  // Determine page type from URL path
  if (path.includes("/assignments")) {
    context.pageType = "assignment";
  } else if (path.includes("/syllabus")) {
    context.pageType = "syllabus";
  } else if (path.includes("/discussion_topics")) {
    context.pageType = "discussion";
  } else if (path.includes("/quizzes")) {
    context.pageType = "quiz";
  } else if (path.includes("/announcements")) {
    context.pageType = "announcement";
  } else if (path.includes("/modules")) {
    context.pageType = "modules";
  } else if (path.includes("/grades")) {
    context.pageType = "grades";
  } else if (path.includes("/pages")) {
    context.pageType = "page";
  } else if (path.includes("/calendar")) {
    context.pageType = "calendar";
  } else {
    context.pageType = "other";
  }

  // Extract due dates visible on the page
  const dueDateElements = document.querySelectorAll(".date_text, .due_date_display, .assignment-date-due");
  if (dueDateElements.length > 0) {
    context.visibleDates = Array.from(dueDateElements)
      .map(el => el.textContent.trim())
      .filter(text => text.length > 0)
      .slice(0, 10);
  }

  // Extract assignment title if on an assignment page
  const assignmentTitle = document.querySelector(".assignment-title h2, #assignment_show h1");
  if (assignmentTitle) {
    context.assignmentTitle = assignmentTitle.textContent.trim();
  }

  return context;
}

let canvasScraperPromise = null;

async function getCanvasScraper() {
  if (!canvasScraperPromise) {
    const moduleUrl = chrome.runtime.getURL("canvas_scraper.js");
    canvasScraperPromise = import(moduleUrl)
      .then((loadedModule) => {
        if (loadedModule && typeof loadedModule.scrapeCanvasModules === "function") {
          return loadedModule.scrapeCanvasModules;
        }

        if (
          typeof globalThis !== "undefined" &&
          globalThis.GurtCanvasScraper &&
          typeof globalThis.GurtCanvasScraper.scrapeCanvasModules === "function"
        ) {
          return globalThis.GurtCanvasScraper.scrapeCanvasModules;
        }

        throw new Error("Unable to load Canvas scraper module.");
      })
      .catch((error) => {
        canvasScraperPromise = null;
        throw error;
      });
  }

  return canvasScraperPromise;
}

function emitScrapeProgress(requestId, progress) {
  const payload = {
    type: "SCRAPE_MODULES_PROGRESS",
    requestId: requestId || null,
    progress
  };

  try {
    chrome.runtime.sendMessage(payload, () => {
      // Swallow best-effort callback errors.
      void chrome.runtime.lastError;
    });
  } catch {
    // Best-effort progress signaling only.
  }
}

async function handleScrapeModulesStart(message, sendResponse) {
  const requestId = message && message.requestId ? String(message.requestId) : null;

  emitScrapeProgress(requestId, {
    stage: "request_received",
    message: "SCRAPE_MODULES_START received by content script."
  });

  try {
    const scrapeCanvasModules = await getCanvasScraper();
    const scrapeOptions =
      message && message.options && typeof message.options === "object"
        ? message.options
        : {};
    const discovered = await scrapeCanvasModules({
      sourceUrl: window.location.href,
      onProgress: (progress) => emitScrapeProgress(requestId, progress),
      concurrency: scrapeOptions.concurrency,
      maxDepth: scrapeOptions.maxDepth,
      maxSources: scrapeOptions.maxSources
    });

    sendResponse({
      success: true,
      requestId,
      discovered,
      count: discovered.length
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    emitScrapeProgress(requestId, {
      stage: "error",
      message: messageText
    });

    sendResponse({
      success: false,
      requestId,
      error: messageText,
      discovered: [],
      count: 0
    });
  }
}

// Respond to runtime requests
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_CONTEXT") {
    sendResponse(extractPageContext());
    return;
  }

  if (message.type === "SCRAPE_MODULES_START") {
    handleScrapeModulesStart(message, sendResponse);
    return true;
  }
});

// Log context on load for debugging
console.log("[Gurt] Content script loaded. Page context:", extractPageContext());
})();
