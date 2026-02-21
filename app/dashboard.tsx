"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createApiClient } from "../src/api/client.ts";
import type { Course } from "../src/api/types.ts";
import { getDefaultRuntimeSettings } from "../src/runtime-settings.ts";

function CourseTrayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 10h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10z" />
      <path d="M7 7h10" />
      <path d="M9 4h6" />
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

  return (
    <main className="page dashboard-page">
      <section className="hero">
        <h1 className="dashboard-heading">Hello, {userName}</h1>
      </section>

      <section className="stack">
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
                    <div className="course-card-tools">
                      <button type="button" className="course-icon-button" aria-label="Open course resources">
                        <CourseTrayIcon />
                      </button>
                      <button type="button" className="course-icon-button" aria-label="Edit course settings">
                        <CourseEditIcon />
                      </button>
                    </div>
                    <Link
                      className="course-card-cta"
                      href={`/flashcards?courseId=${encodeURIComponent(course.id)}`}
                    >
                      View Course
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
