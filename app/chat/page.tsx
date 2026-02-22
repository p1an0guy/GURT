"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createApiClient } from "../../src/api/client.ts";
import { getRenderableChatCitations } from "../../src/chat/citations.ts";
import {
  readCourseHistory,
  readSelectedCourseId,
  writeCourseHistory,
  writeSelectedCourseId,
  type ChatMessage,
} from "../../src/chat/store.ts";
import { getDefaultRuntimeSettings } from "../../src/runtime-settings.ts";
import type { Course } from "../../src/api/types.ts";

export default function ChatPage() {
  const [settings] = useState(getDefaultRuntimeSettings);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [courseLoadError, setCourseLoadError] = useState("");

  const [isCoursePickerVisible, setIsCoursePickerVisible] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState("");

  const messageListRef = useRef<HTMLDivElement>(null);

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: settings.baseUrl,
        useFixtures: settings.useFixtures,
      }),
    [settings.baseUrl, settings.useFixtures],
  );

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) ?? null,
    [courses, selectedCourseId],
  );

  const loadCourses = useCallback(async (): Promise<void> => {
    setIsLoadingCourses(true);
    setCourseLoadError("");
    try {
      const rows = await client.listCourses();
      setCourses(rows);

      const persistedCourseId = readSelectedCourseId();
      if (persistedCourseId && rows.some((course) => course.id === persistedCourseId)) {
        setSelectedCourseId(persistedCourseId);
        setMessages(readCourseHistory(persistedCourseId));
        setIsCoursePickerVisible(false);
      } else {
        setSelectedCourseId(null);
        setMessages([]);
        setIsCoursePickerVisible(true);
      }
    } catch (loadError) {
      setCourses([]);
      setIsCoursePickerVisible(true);
      setCourseLoadError(
        loadError instanceof Error
          ? loadError.message
          : "We could not load your courses right now.",
      );
    } finally {
      setIsLoadingCourses(false);
    }
  }, [client]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    if (!messageListRef.current) {
      return;
    }
    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [messages, isSending]);

  function handleSelectCourse(courseId: string): void {
    setSelectedCourseId(courseId);
    setMessages(readCourseHistory(courseId));
    setDraft("");
    setSendError("");
    setIsCoursePickerVisible(false);
    writeSelectedCourseId(courseId);
  }

  function handleSwitchCourse(): void {
    setIsCoursePickerVisible(true);
    setSelectedCourseId(null);
    setMessages([]);
    setSendError("");
    writeSelectedCourseId(null);
  }

  async function handleSendMessage(): Promise<void> {
    if (isSending) {
      return;
    }

    const courseId = selectedCourseId?.trim() ?? "";
    if (!courseId) {
      setSendError("Choose a course before sending a message.");
      return;
    }

    const text = draft.trim();
    if (!text) {
      return;
    }

    setDraft("");
    setSendError("");

    const userMessage: ChatMessage = {
      role: "user",
      text,
    };
    const historyWithUser = [...messages, userMessage];
    setMessages(historyWithUser);
    writeCourseHistory(courseId, historyWithUser);

    setIsSending(true);
    try {
      const response = await client.chat(courseId, text);
      const renderableCitations = getRenderableChatCitations(response);
      const assistantMessage: ChatMessage = {
        role: "assistant",
        text: response.answer,
        ...(renderableCitations.length > 0 ? { citations: renderableCitations } : {}),
      };
      const nextHistory = [...historyWithUser, assistantMessage];
      setMessages(nextHistory);
      writeCourseHistory(courseId, nextHistory);
    } catch (error) {
      const errorMessage: ChatMessage = {
        role: "error",
        text: error instanceof Error ? error.message : "Failed to send message.",
      };
      const nextHistory = [...historyWithUser, errorMessage];
      setMessages(nextHistory);
      writeCourseHistory(courseId, nextHistory);
    } finally {
      setIsSending(false);
    }
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage();
    }
  }

  return (
    <main className="page chat-page chat-modern">
      <section className="hero chat-modern-hero">
        <div className="chat-hero-content">
          <p className="chat-kicker">Study Lab</p>
          <h1>Chat</h1>
          <p>Ask grounded questions about one course at a time.</p>
        </div>
      </section>

      {isCoursePickerVisible ? (
        <section className="panel chat-course-picker">
          <h2>Choose a Course</h2>
          <p className="small">
            Select the course you want to chat about. GURT will use this course as your RAG context.
          </p>

          {isLoadingCourses ? <p className="small">Loading courses...</p> : null}
          {courseLoadError ? (
            <div className="stack">
              <p className="error-text">{courseLoadError}</p>
              <button type="button" className="secondary-button" onClick={() => void loadCourses()}>
                Retry
              </button>
            </div>
          ) : null}
          {!isLoadingCourses && !courseLoadError && courses.length === 0 ? (
            <p className="small">No courses available yet. Connect Canvas and run sync first.</p>
          ) : null}

          {!isLoadingCourses && !courseLoadError && courses.length > 0 ? (
            <div className="chat-course-grid">
              {courses.map((course) => (
                <button
                  key={course.id}
                  type="button"
                  className="chat-course-card"
                  onClick={() => handleSelectCourse(course.id)}
                >
                  <span className="chat-course-swatch" style={{ background: course.color }} aria-hidden="true" />
                  <span className="chat-course-title">{course.name}</span>
                  <span className="chat-course-meta">
                    {course.term} · {course.id}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <section className="panel chat-shell">
          <header className="chat-shell-header">
            <div className="chat-shell-course">
              <h2>{selectedCourse?.name ?? selectedCourseId}</h2>
              <p className="small">
                {selectedCourse?.term ? `${selectedCourse.term} · ` : ""}
                {selectedCourseId}
              </p>
            </div>
            <button type="button" className="secondary-button" onClick={handleSwitchCourse} disabled={isSending}>
              Switch Course
            </button>
          </header>

          <div className="chat-message-list" ref={messageListRef} aria-live="polite">
            {messages.length === 0 ? (
              <p className="chat-empty-state">Ask your first question to begin.</p>
            ) : null}

            {messages.map((message, index) => (
              <article key={`${message.role}-${index}-${message.text.slice(0, 16)}`} className={`chat-message ${message.role}`}>
                <div className="chat-message-bubble">
                  <p>{message.text}</p>
                  {message.role === "assistant" && message.citations && message.citations.length > 0 ? (
                    <ul className="chat-citations">
                      {message.citations.map((citation) => (
                        <li key={`${citation.source}-${citation.url}`}>
                          <a href={citation.url} target="_blank" rel="noreferrer">
                            {citation.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </article>
            ))}

            {isSending ? (
              <article className="chat-message assistant">
                <div className="chat-message-bubble">
                  <p>Thinking...</p>
                </div>
              </article>
            ) : null}
          </div>

          <div className="chat-composer">
            <div className="chat-composer-row">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Ask about this course..."
                rows={2}
                disabled={isSending}
              />
              <button type="button" onClick={() => void handleSendMessage()} disabled={isSending || !draft.trim()}>
                {isSending ? "Sending..." : "Send"}
              </button>
            </div>
            {sendError ? <p className="error-text">{sendError}</p> : null}
          </div>
        </section>
      )}
    </main>
  );
}
