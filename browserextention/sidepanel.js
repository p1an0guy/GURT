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

function appendMessage(role, text, save = true) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.textContent = text;
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
