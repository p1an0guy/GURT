"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { createApiClient } from "../../src/api/client.ts";
import { getDefaultRuntimeSettings } from "../../src/runtime-settings.ts";
import type { Course, PracticeExam } from "../../src/api/types.ts";
import {
  createPracticeTestRecord,
  getPracticeTestById,
  listRecentPracticeTests,
  type PracticeTestSummary,
} from "../../src/practice-tests/store.ts";
import { pollPracticeExamJob } from "../../src/practice-tests/polling.ts";

const PRACTICE_EXAM_POLL_WAIT_MS = 4000;
const PRACTICE_EXAM_POLL_MAX_ATTEMPTS = 60;

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function AiStarsIcon() {
  return (
    <svg viewBox="0 0 37 38" fill="none" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M13.2126 5.42901C13.4997 5.42907 13.779 5.52519 14.0082 5.70281C14.2374 5.88044 14.404 6.1299 14.4829 6.41347L15.9152 11.5638C16.2236 12.673 16.8022 13.6831 17.5963 14.4988C18.3904 15.3144 19.3738 15.9087 20.4537 16.2255L25.4678 17.6968C25.7437 17.778 25.9863 17.9492 26.1591 18.1846C26.3318 18.42 26.4252 18.7068 26.4252 19.0015C26.4252 19.2963 26.3318 19.5831 26.1591 19.8185C25.9863 20.0539 25.7437 20.2251 25.4678 20.3063L20.4537 21.7776C19.3738 22.0944 18.3904 22.6886 17.5963 23.5043C16.8022 24.32 16.2236 25.3301 15.9152 26.4393L14.4829 31.5896C14.4038 31.873 14.2371 32.1222 14.008 32.2997C13.7788 32.4771 13.4996 32.5731 13.2126 32.5731C12.9256 32.5731 12.6464 32.4771 12.4173 32.2997C12.1881 32.1222 12.0214 31.873 11.9424 31.5896L10.51 26.4393C10.2016 25.3301 9.62303 24.32 8.82893 23.5043C8.03483 22.6886 7.05143 22.0944 5.97158 21.7776L0.957472 20.3063C0.681581 20.2251 0.438921 20.0539 0.266178 19.8185C0.0934347 19.5831 0 19.2963 0 19.0015C0 18.7068 0.0934347 18.42 0.266178 18.1846C0.438921 17.9492 0.681581 17.778 0.957472 17.6968L5.97158 16.2255C7.05143 15.9087 8.03483 15.3144 8.82893 14.4988C9.62303 13.6831 10.2016 12.673 10.51 11.5638L11.9424 6.41347C12.0212 6.1299 12.1878 5.88044 12.417 5.70281C12.6462 5.52519 12.9255 5.42907 13.2126 5.42901ZM29.0689 2.10621e-07C29.3637 -0.00016841 29.65 0.100914 29.8825 0.28717C30.1149 0.473426 30.28 0.734158 30.3515 1.02789L30.806 2.90271C31.2218 4.6038 32.515 5.9321 34.1711 6.35918L35.9963 6.82608C36.2828 6.89897 36.5374 7.06831 36.7193 7.30709C36.9012 7.54586 37 7.84032 37 8.14352C37 8.44671 36.9012 8.74117 36.7193 8.97995C36.5374 9.21872 36.2828 9.38806 35.9963 9.46096L34.1711 9.92785C32.515 10.3549 31.2218 11.6832 30.806 13.3843L30.3515 15.2591C30.2805 15.5534 30.1157 15.8149 29.8832 16.0017C29.6507 16.1886 29.3641 16.2901 29.0689 16.2901C28.7737 16.2901 28.4871 16.1886 28.2546 16.0017C28.0221 15.8149 27.8573 15.5534 27.7863 15.2591L27.3318 13.3843C27.1285 12.549 26.708 11.7862 26.1153 11.1774C25.5226 10.5686 24.7799 10.1367 23.9667 9.92785L22.1415 9.46096C21.8549 9.38806 21.6004 9.21872 21.4185 8.97995C21.2366 8.74117 21.1378 8.44671 21.1378 8.14352C21.1378 7.84032 21.2366 7.54586 21.4185 7.30709C21.6004 7.06831 21.8549 6.89897 22.1415 6.82608L23.9667 6.35918C24.7799 6.15037 25.5226 5.71847 26.1153 5.10965C26.708 4.50083 27.1285 3.738 27.3318 2.90271L27.7863 1.02789C27.8578 0.734158 28.0229 0.473426 28.2553 0.28717C28.4878 0.100914 28.7741 -0.00016841 29.0689 2.10621e-07ZM26.4262 24.4306C26.7037 24.4304 26.9742 24.52 27.1994 24.6866C27.4245 24.8532 27.5929 25.0885 27.6806 25.3589L28.3748 27.4998C28.639 28.3087 29.2557 28.9457 30.0449 29.2153L32.1292 29.9301C32.3916 30.0206 32.6198 30.1935 32.7814 30.4244C32.943 30.6553 33.03 30.9325 33.03 31.2168C33.03 31.5012 32.943 31.7784 32.7814 32.0092C32.6198 32.2401 32.3916 32.413 32.1292 32.5035L30.0449 33.2183C29.2574 33.4898 28.6373 34.1231 28.3748 34.9339L27.6788 37.0747C27.5907 37.3443 27.4224 37.5786 27.1976 37.7447C26.9729 37.9107 26.703 38 26.4262 38C26.1493 38 25.8795 37.9107 25.6547 37.7447C25.43 37.5786 25.2617 37.3443 25.1735 37.0747L24.4776 34.9339C24.3478 34.5345 24.1294 34.1715 23.8395 33.8738C23.5496 33.576 23.1963 33.3516 22.8074 33.2183L20.7232 32.5035C20.4608 32.413 20.2326 32.2401 20.071 32.0092C19.9094 31.7784 19.8224 31.5012 19.8224 31.2168C19.8224 30.9325 19.9094 30.6553 20.071 30.4244C20.2326 30.1935 20.4608 30.0206 20.7232 29.9301L22.8074 29.2153C23.595 28.9439 24.2151 28.3105 24.4776 27.4998L25.1735 25.3589C25.2611 25.0888 25.4292 24.8537 25.654 24.6871C25.8788 24.5205 26.149 24.4308 26.4262 24.4306Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function PracticeTestsPage() {
  const [settings] = useState(getDefaultRuntimeSettings);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("course-psych-101");
  const [numQuestions, setNumQuestions] = useState("10");
  const [exam, setExam] = useState<PracticeExam | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [score, setScore] = useState<number | null>(null);
  const [savedTests, setSavedTests] = useState<PracticeTestSummary[]>([]);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [hasAttemptedCourseLoad, setHasAttemptedCourseLoad] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [courseLoadError, setCourseLoadError] = useState("");
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [isConfirmingEnd, setIsConfirmingEnd] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: settings.baseUrl,
        useFixtures: settings.useFixtures,
      }),
    [settings.baseUrl, settings.useFixtures],
  );

  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);
  const isInTestSession = exam !== null;
  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === courseId) ?? null,
    [courses, courseId],
  );
  const testReport = useMemo(() => {
    if (!exam) {
      return null;
    }

    const totalQuestions = exam.questions.length;
    const answeredQuestions = exam.questions.filter(
      (question) => typeof answers[question.id] === "number",
    ).length;
    const correctAnswers = exam.questions.filter(
      (question) => answers[question.id] === question.answerIndex,
    ).length;
    const incorrectAnswers = answeredQuestions - correctAnswers;
    const unansweredQuestions = totalQuestions - answeredQuestions;
    const scorePercent =
      totalQuestions === 0 ? 0 : Math.round((correctAnswers / totalQuestions) * 100);
    const missedQuestionNumbers = exam.questions
      .map((question, index) => ({ question, index }))
      .filter(
        ({ question }) =>
          typeof answers[question.id] === "number" &&
          answers[question.id] !== question.answerIndex,
      )
      .map(({ index }) => index + 1);

    return {
      totalQuestions,
      answeredQuestions,
      correctAnswers,
      incorrectAnswers,
      unansweredQuestions,
      scorePercent,
      missedQuestionNumbers,
    };
  }, [exam, answers]);

  async function loadCourses(): Promise<void> {
    setIsLoadingCourses(true);
    setCourseLoadError("");
    try {
      const rows = await client.listCourses();
      setCourses(rows);
      setCoursesLoaded(true);
      setCourseId((currentCourseId) => {
        if (rows.some((row) => row.id === currentCourseId)) {
          return currentCourseId;
        }
        return rows.length > 0 ? rows[0].id : currentCourseId;
      });
    } catch (loadError) {
      setCoursesLoaded(false);
      setCourseLoadError(
        loadError instanceof Error
          ? loadError.message
          : "We could not load your courses right now.",
      );
    } finally {
      setIsLoadingCourses(false);
      setHasAttemptedCourseLoad(true);
    }
  }

  useEffect(() => {
    void loadCourses();
    setSavedTests(listRecentPracticeTests());
  }, [client]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramCourseId = params.get("courseId");
    if (paramCourseId) {
      setCourseId(paramCourseId);
    }
  }, []);

  useEffect(() => {
    if (!exam || exam.questions.length === 0) {
      setActiveQuestionId(null);
      return;
    }
    setActiveQuestionId(exam.questions[0].id);
  }, [exam]);

  function selectChoice(questionId: string, choiceIndex: number): void {
    if (isSubmitted) {
      return;
    }
    setAnswers((current) => ({
      ...current,
      [questionId]: choiceIndex,
    }));
  }

  async function handleGenerateExam(): Promise<void> {
    setMessage("");
    setError("");
    setIsGenerating(true);
    setIsReportOpen(false);
    try {
      const requested = Number.parseInt(numQuestions, 10);
      const requestedCount = Number.isNaN(requested) ? 10 : requested;
      const started = await client.startPracticeExamGeneration(
        courseId,
        requestedCount,
      );
      const generated = await pollPracticeExamJob({
        jobId: started.jobId,
        maxAttempts: PRACTICE_EXAM_POLL_MAX_ATTEMPTS,
        waitMs: PRACTICE_EXAM_POLL_WAIT_MS,
        getStatus: (jobId) => client.getPracticeExamGenerationStatus(jobId),
        wait: waitMs,
      });
      const courseName = selectedCourse?.name ?? courseId;
      const created = createPracticeTestRecord({
        courseId,
        courseName,
        exam: generated,
      });
      setSavedTests(listRecentPracticeTests());
      setExam(created.exam);
      setAnswers({});
      setScore(null);
      setIsSubmitted(false);
      setIsGenerateModalOpen(false);
      setMessage(`Generated ${generated.questions.length} questions.`);
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Failed to generate practice exam.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function handleSubmitAnswers(): void {
    if (!exam) {
      return;
    }
    const correct = exam.questions.reduce((total, question) => {
      return total + (answers[question.id] === question.answerIndex ? 1 : 0);
    }, 0);
    setScore(correct);
    setIsSubmitted(true);
    setIsReportOpen(true);
    setMessage(`You scored ${correct}/${exam.questions.length}.`);
  }

  function handleExitTestSession(): void {
    setExam(null);
    setAnswers({});
    setScore(null);
    setIsSubmitted(false);
    setMessage("");
    setError("");
    setIsConfirmingEnd(false);
    setIsReportOpen(false);
  }

  function jumpToQuestion(questionId: string): void {
    setActiveQuestionId(questionId);
    const target = document.getElementById(`practice-question-${questionId}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleStartSavedTest(testId: string): void {
    const record = getPracticeTestById(testId);
    if (!record) {
      setError("We could not load that saved practice test.");
      return;
    }
    setCourseId(record.courseId);
    setExam(record.exam);
    setAnswers({});
    setScore(null);
    setIsSubmitted(false);
    setIsConfirmingEnd(false);
    setIsReportOpen(false);
    setIsGenerateModalOpen(false);
    setError("");
  }

  return (
    <main className={`page practice-test-page${isInTestSession ? " in-session" : ""}`}>
      {!isInTestSession ? (
        <>
          <section className="hero">
            <h1>Practice Tests</h1>
            <p>
              Generate timed-style multiple-choice sets and check your answers instantly.
            </p>
          </section>
        </>
      ) : null}

      {!isInTestSession ? (
        <section className="panel-grid">
          <article className="panel">
            <div className="practice-tests-list-header">
              <h2>Saved Practice Tests</h2>
              <button
                type="button"
                className="compact-button"
                onClick={() => setIsGenerateModalOpen(true)}
              >
                + New Test
              </button>
            </div>
            {message ? <p className="small">{message}</p> : null}
            {error ? <p className="error-text">{error}</p> : null}
            {savedTests.length === 0 ? (
              <p className="small">
                No practice tests yet. Create your first one to get started.
              </p>
            ) : (
              <ul className="list">
                {savedTests.map((test) => (
                  <li key={test.testId}>
                    <strong>{test.title}</strong>
                    <span className="tag">{test.courseName}</span>
                    <div className="small">
                      {test.questionCount} question(s) • Created {test.createdAt}
                    </div>
                    <div className="practice-test-list-actions">
                      <button type="button" onClick={() => handleStartSavedTest(test.testId)}>
                        Take Test
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>
      ) : (
        <section className="practice-test-session">
          <div className="practice-test-hud">
            <div className="practice-test-hud-nav" role="navigation" aria-label="Question navigator">
              {exam.questions.map((question, questionIndex) => {
                const isAnswered = typeof answers[question.id] === "number";
                const isActive = question.id === activeQuestionId;
                return (
                  <button
                    key={`nav-${question.id}`}
                    type="button"
                    className={`practice-nav-chip${isActive ? " active" : ""}${isAnswered ? " answered" : ""}`}
                    onClick={() => jumpToQuestion(question.id)}
                  >
                    {questionIndex + 1}
                  </button>
                );
              })}
            </div>
            <div className="practice-test-hud-actions">
              {!isConfirmingEnd ? (
                <button
                  type="button"
                  className="practice-end-text-button"
                  onClick={() => setIsConfirmingEnd(true)}
                >
                  End test
                </button>
              ) : (
                <div className="practice-end-confirm">
                  <p className="small">End this test? Your current answers will be lost.</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setIsConfirmingEnd(false)}
                  >
                    Cancel
                  </button>
                  <button type="button" onClick={handleExitTestSession}>
                    End Test
                  </button>
                </div>
              )}
            </div>
          </div>

          <article className="panel">
            <h2>Practice Test In Progress</h2>
            <div className="stack">
              <div className="practice-test-info">
                <p className="small practice-test-info-line">
                  <span>{selectedCourse ? `${selectedCourse.name} (${selectedCourse.term})` : exam.courseId}</span>
                  <span>Generated {exam.generatedAt}</span>
                  <span>{exam.questions.length} question(s)</span>
                  {isSubmitted && score !== null ? (
                    <span className="status ok">Score {score}/{exam.questions.length}</span>
                  ) : (
                    <span>Answered {answeredCount}/{exam.questions.length}</span>
                  )}
                </p>
              </div>
              <ul className="practice-question-list">
                {exam.questions.map((question, questionIndex) => (
                  <li
                    key={question.id}
                    id={`practice-question-${question.id}`}
                    className="practice-question"
                  >
                    <p className="practice-question-prompt">
                      <strong>Q{questionIndex + 1}.</strong> {question.prompt}
                    </p>
                    <div className="practice-choice-grid">
                      {question.choices.map((choice, choiceIndex) => {
                        const selected = answers[question.id] === choiceIndex;
                        const isCorrectChoice = choiceIndex === question.answerIndex;
                        const showAsCorrect = isSubmitted && isCorrectChoice;
                        const showAsWrong = isSubmitted && selected && !isCorrectChoice;
                        return (
                          <button
                            key={`${question.id}-${choiceIndex}`}
                            type="button"
                            className={`practice-choice${selected ? " selected" : ""}${showAsCorrect ? " correct" : ""}${showAsWrong ? " wrong" : ""}`}
                            onClick={() => selectChoice(question.id, choiceIndex)}
                            disabled={isSubmitted}
                          >
                            {choice}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={handleSubmitAnswers}
                disabled={
                  isSubmitted ||
                  exam.questions.length === 0 ||
                  answeredCount !== exam.questions.length
                }
              >
                {isSubmitted ? "Submitted" : "Submit Answers"}
              </button>
            </div>
          </article>
        </section>
      )}
      {isGenerateModalOpen ? (
        <div
          className="practice-generate-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="practiceGenerateTitle"
        >
          <section className="practice-generate-modal">
            <h3 id="practiceGenerateTitle">Generate Practice Test</h3>
            <div className="controls">
              <label htmlFor="courseSelect">Course</label>
              {coursesLoaded ? (
                <select
                  id="courseSelect"
                  value={courseId}
                  onChange={(event) => setCourseId(event.target.value)}
                >
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name} ({course.term})
                    </option>
                  ))}
                </select>
              ) : isLoadingCourses || !hasAttemptedCourseLoad ? (
                <div className="status-block">
                  <p className="small">Loading courses...</p>
                </div>
              ) : (
                <div className="status-block">
                  <p className="small">We could not load your courses right now.</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void loadCourses()}
                    disabled={isLoadingCourses}
                  >
                    Try Again
                  </button>
                  {courseLoadError ? <p className="small mono">{courseLoadError}</p> : null}
                </div>
              )}

              <label htmlFor="numQuestions">Number of Questions</label>
              <input
                id="numQuestions"
                value={numQuestions}
                onChange={(event) => setNumQuestions(event.target.value)}
                placeholder="10"
              />

              {error ? <p className="error-text">{error}</p> : null}
              <div className="practice-generate-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsGenerateModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleGenerateExam}
                  disabled={isGenerating || isLoadingCourses || !coursesLoaded}
                >
                  {isGenerating ? "Generating..." : "Start Test"}
                </button>
              </div>
              <p className="small">
                Need diagnostics? <Link href="/dev-tools">Open dev tools</Link>.
              </p>
            </div>
          </section>
        </div>
      ) : null}
      {isReportOpen && exam && testReport ? (
        <div className="practice-report-overlay" role="dialog" aria-modal="true" aria-labelledby="practiceReportTitle">
          <section className="practice-report-modal">
            <header className="practice-report-header">
              <p className="practice-report-eyebrow">Session Complete</p>
              <h3 id="practiceReportTitle">Practice Test Report</h3>
              <p className="small">
                {selectedCourse ? `${selectedCourse.name} (${selectedCourse.term})` : exam.courseId}
              </p>
            </header>
            <section className="practice-report-score-card" aria-label="Overall score">
              <p className="practice-report-score-label">Overall Score</p>
              <p className="practice-report-score-value">
                {testReport.correctAnswers}/{testReport.totalQuestions}
              </p>
              <p className="practice-report-score-percent">{testReport.scorePercent}% accuracy</p>
            </section>
            <div className="practice-report-grid">
              <p className="practice-report-tile">
                <strong>Answered</strong>
                <span>{testReport.answeredQuestions}</span>
              </p>
              <p className="practice-report-tile practice-report-tile-ok">
                <strong>Correct</strong>
                <span>{testReport.correctAnswers}</span>
              </p>
              <p className="practice-report-tile practice-report-tile-warn">
                <strong>Incorrect</strong>
                <span>{testReport.incorrectAnswers}</span>
              </p>
              <p className="practice-report-tile">
                <strong>Unanswered</strong>
                <span>{testReport.unansweredQuestions}</span>
              </p>
              <p className="practice-report-tile practice-report-tile-wide">
                <strong>Missed Questions</strong>
                <span>
                  {testReport.missedQuestionNumbers.length > 0
                    ? testReport.missedQuestionNumbers.join(", ")
                    : "None"}
                </span>
              </p>
            </div>
            <div className="practice-report-actions">
              <button
                type="button"
                onClick={() => {
                  setIsReportOpen(false);
                  void handleGenerateExam();
                }}
              >
                Retake Test
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleExitTestSession}
              >
                Back to Practice Tests
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
