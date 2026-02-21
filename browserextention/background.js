// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Handle messages from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CHAT_QUERY") {
    handleChatQuery(message.query, message.context).then(sendResponse);
    return true; // Keep the message channel open for async response
  }
});

const API_URL = "https://hpthlfk5ql.execute-api.us-west-2.amazonaws.com/dev/chat";

async function handleChatQuery(query, pageContext) {
  try {
    const body = { question: query };

    // Get courseId from the active tab URL directly
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

    // Fall back to content script context if we didn't get courseId
    if (!body.courseId && pageContext && pageContext.courseId) {
      body.courseId = pageContext.courseId;
    }
    if (pageContext) {
      body.context = pageContext;
    }

    const response = await fetch(API_URL, {
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

    return { success: true, answer: data.answer || data.message || JSON.stringify(data) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
