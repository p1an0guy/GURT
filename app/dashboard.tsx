"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createApiClient } from "../src/api/client.ts";
import type { Course } from "../src/api/types.ts";
import { getDefaultRuntimeSettings } from "../src/runtime-settings.ts";

function CourseTrayIcon() {
  return (
    <svg className="course-tray-icon" viewBox="0 0 36 35" fill="none" aria-hidden="true">
      <path
        d="M32.9548 11.9149H2.65153C1.9483 11.9149 1.27388 12.1895 0.776616 12.6783C0.279357 13.1671 0 13.83 0 14.5213V32.3936C0 33.0849 0.279357 33.7478 0.776616 34.2366C1.27388 34.7254 1.9483 35 2.65153 35H32.9548C33.658 35 34.3324 34.7254 34.8297 34.2366C35.3269 33.7478 35.6063 33.0849 35.6063 32.3936V14.5213C35.6063 13.83 35.3269 13.1671 34.8297 12.6783C34.3324 12.1895 33.658 11.9149 32.9548 11.9149ZM33.3336 32.3936C33.3336 32.4924 33.2937 32.5871 33.2226 32.6569C33.1516 32.7267 33.0552 32.766 32.9548 32.766H2.65153C2.55107 32.766 2.45472 32.7267 2.38369 32.6569C2.31265 32.5871 2.27274 32.4924 2.27274 32.3936V14.5213C2.27274 14.4225 2.31265 14.3278 2.38369 14.258C2.45472 14.1882 2.55107 14.1489 2.65153 14.1489H32.9548C33.0552 14.1489 33.1516 14.1882 33.2226 14.258C33.2937 14.3278 33.3336 14.4225 33.3336 14.5213V32.3936ZM3.03032 7.07447C3.03032 6.77822 3.15005 6.4941 3.36316 6.28461C3.57627 6.07513 3.86531 5.95745 4.16669 5.95745H31.4396C31.741 5.95745 32.03 6.07513 32.2431 6.28461C32.4563 6.4941 32.576 6.77822 32.576 7.07447C32.576 7.37072 32.4563 7.65484 32.2431 7.86432C32.03 8.0738 31.741 8.19149 31.4396 8.19149H4.16669C3.86531 8.19149 3.57627 8.0738 3.36316 7.86432C3.15005 7.65484 3.03032 7.37072 3.03032 7.07447ZM6.06065 1.11702C6.06065 0.820769 6.18037 0.53665 6.39348 0.327168C6.60659 0.117686 6.89563 0 7.19702 0H28.4093C28.7107 0 28.9997 0.117686 29.2128 0.327168C29.4259 0.53665 29.5457 0.820769 29.5457 1.11702C29.5457 1.41327 29.4259 1.69739 29.2128 1.90687C28.9997 2.11636 28.7107 2.23404 28.4093 2.23404H7.19702C6.89563 2.23404 6.60659 2.11636 6.39348 1.90687C6.18037 1.69739 6.06065 1.41327 6.06065 1.11702Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CourseEditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="M12 8l4 4" />
    </svg>
  );
}

export default function DashboardPage() {
  const [settings] = useState(getDefaultRuntimeSettings);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [calendarFeedUrl, setCalendarFeedUrl] = useState("");
  const [calendarStatus, setCalendarStatus] = useState("");
  const [calendarError, setCalendarError] = useState("");
  const [isMintingCalendar, setIsMintingCalendar] = useState(false);

  const userName = "Student";

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: settings.baseUrl,
        useFixtures: settings.useFixtures,
      }),
    [settings.baseUrl, settings.useFixtures],
  );

  useEffect(() => {
    async function loadCourses(): Promise<void> {
      setIsLoading(true);
      setError("");
      try {
        const rows = await client.listCourses();
        setCourses(rows);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "We could not load your courses right now.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void loadCourses();
  }, [client]);

  async function handleMintCalendarFeed(): Promise<void> {
    setCalendarStatus("");
    setCalendarError("");
    setIsMintingCalendar(true);
    try {
      const minted = await client.createCalendarToken();
      setCalendarFeedUrl(minted.feedUrl);
      setCalendarStatus(`Calendar feed minted at ${minted.createdAt}.`);
    } catch (mintError) {
      setCalendarError(
        mintError instanceof Error
          ? mintError.message
          : "We could not mint a calendar feed right now.",
      );
    } finally {
      setIsMintingCalendar(false);
    }
  }

  async function handleCopyCalendarUrl(): Promise<void> {
    if (!calendarFeedUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(calendarFeedUrl);
      setCalendarStatus("Calendar feed URL copied to clipboard.");
      setCalendarError("");
    } catch {
      setCalendarError("Clipboard copy failed. Copy the URL manually.");
    }
  }

  return (
    <main className="page dashboard-page dashboard-modern">
      <section className="hero dashboard-modern-hero">
        <div className="dashboard-hero-content">
          <p className="dashboard-kicker">Study Lab</p>
          <h1 className="dashboard-heading">Hello, {userName}</h1>
          <p>Track your calendar feed, browse courses, and jump into your study tools.</p>
        </div>
      </section>

      <section className="stack">
        <article className="panel calendar-feed-panel">
          <h2>Calendar Feed</h2>
          <p className="small">
            Generate a private ICS URL for this user, then subscribe from Google Calendar.
          </p>
          <div className="calendar-feed-actions">
            <button type="button" onClick={handleMintCalendarFeed} disabled={isMintingCalendar}>
              {isMintingCalendar ? "Generating..." : "Generate ICS URL"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handleCopyCalendarUrl}
              disabled={!calendarFeedUrl}
            >
              Copy URL
            </button>
            {calendarFeedUrl ? (
              <a className="dashboard-cta-button" href={calendarFeedUrl} target="_blank" rel="noreferrer">
                Open Feed
              </a>
            ) : null}
          </div>
          <p className="mono">{calendarFeedUrl || "(Generate a URL to display it here.)"}</p>
          {calendarStatus ? <p className="small">{calendarStatus}</p> : null}
          {calendarError ? <p className="error-text">{calendarError}</p> : null}
        </article>

        <h2>Your Courses</h2>
        {isLoading ? <p className="small">Loading courses...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {!isLoading && !error ? (
          <div className="course-grid">
            {courses.map((course) => (
              <article key={course.id} className="course-card">
                <div
                  className="course-card-media"
                  style={{ background: course.color || "#9f9f9f" }}
                />
                <div className="course-card-body">
                  <div className="course-card-text">
                    <h3>{course.name}</h3>
                    <p className="course-card-term">{course.term}</p>
                    <p className="small mono">{course.id}</p>
                  </div>
                  <div className="course-card-actions">
                    <Link
                      className="course-icon-button course-card-action-button"
                      href={`/flashcards?courseId=${encodeURIComponent(course.id)}`}
                      aria-label={`Open flashcards for ${course.name}`}
                    >
                      <CourseTrayIcon />
                      <span>Flashcards</span>
                    </Link>
                    <Link
                      className="course-icon-button course-card-action-button"
                      href={`/practice-tests?courseId=${encodeURIComponent(course.id)}`}
                      aria-label={`Open practice tests for ${course.name}`}
                    >
                      <CourseEditIcon />
                      <span>Practice Tests</span>
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
        {!isLoading && !error && courses.length === 0 ? (
          <p className="small">No courses found yet.</p>
        ) : null}
      </section>
    </main>
  );
}
