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

// Respond to context requests from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_CONTEXT") {
    sendResponse(extractPageContext());
  }
});

// Log context on load for debugging
console.log("[Gurt] Content script loaded. Page context:", extractPageContext());
