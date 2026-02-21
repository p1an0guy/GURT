const messagesContainer = document.getElementById("messages");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

// Load chat history on open
chrome.storage.local.get("chatHistory", ({ chatHistory }) => {
  if (chatHistory && chatHistory.length > 0) {
    chatHistory.forEach(msg => appendMessage(msg.role, msg.text, false));
    scrollToBottom();
  }
});

sendBtn.addEventListener("click", sendMessage);

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

  // Send query to background service worker
  try {
    const response = await chrome.runtime.sendMessage({
      type: "CHAT_QUERY",
      query: text,
      context: pageContext
    });

    typingEl.remove();

    if (response && response.success) {
      appendMessage("bot", response.answer);
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

  for (const line of lines) {
    const trimmed = line.trim();

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

  // Inline formatting
  let html = out.join("");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  return html;
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
  chrome.storage.local.get("chatHistory", ({ chatHistory }) => {
    const history = chatHistory || [];
    history.push({ role, text });
    // Keep last 100 messages
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
    chrome.storage.local.set({ chatHistory: history });
  });
}
