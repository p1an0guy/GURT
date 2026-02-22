import test from "node:test";
import assert from "node:assert/strict";
import "./blocking_engine.js";

const Engine = globalThis.GurtBlockingEngine;

function epochAtLocal(year, monthZeroBased, day, hour, minute, second = 0) {
  return Math.floor(new Date(year, monthZeroBased, day, hour, minute, second, 0).getTime() / 1000);
}

test("plain host blocking matches domain", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "reddit.com",
    scheduleDays: [true, true, true, true, true, true, true],
    timeRanges: "0000-2400",
    limitMinutes: null,
    limitPeriod: null,
    pomodoroEnabled: false,
    allowlistHard: []
  }, []);

  const runtime = Engine.normalizeRuntime({});
  const compiled = Engine.compileSiteMatchers(config.sites);
  const decision = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://www.reddit.com/r/programming",
    now: epochAtLocal(2026, 1, 22, 12, 0)
  });

  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, "blocked_schedule");
});

test("allow exception takes precedence", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "reddit.com +news.reddit.com",
    scheduleDays: [true, true, true, true, true, true, true],
    timeRanges: "0000-2400",
    pomodoroEnabled: false,
    allowlistHard: []
  }, []);

  const runtime = Engine.normalizeRuntime({});
  const compiled = Engine.compileSiteMatchers(config.sites);
  const decision = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://news.reddit.com/top",
    now: epochAtLocal(2026, 1, 22, 12, 0)
  });

  assert.equal(decision.blocked, false);
  assert.equal(decision.reason, "allow_rule_match");
});

test("wildcard host pattern blocks subdomains", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "*.youtube.com",
    scheduleDays: [true, true, true, true, true, true, true],
    timeRanges: "0000-2400",
    pomodoroEnabled: false,
    allowlistHard: []
  }, []);

  const runtime = Engine.normalizeRuntime({});
  const compiled = Engine.compileSiteMatchers(config.sites);
  const decision = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://music.youtube.com/watch?v=abc",
    now: epochAtLocal(2026, 1, 22, 12, 0)
  });

  assert.equal(decision.blocked, true);
});

test("invalid time range fails validation", () => {
  const result = Engine.validateConfig({
    enabled: true,
    sites: "example.com",
    scheduleDays: [true, true, true, true, true, true, true],
    timeRanges: "25AA-2900"
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((value) => value.includes("Invalid time range")));
});

test("invalid site pattern is rejected", () => {
  const result = Engine.validateConfig({
    enabled: true,
    sites: "/",
    scheduleDays: [true, true, true, true, true, true, true],
    timeRanges: "0000-2400"
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((value) => value.includes("Invalid site pattern")));
});

test("schedule only blocks in configured window", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "x.com",
    scheduleDays: [false, true, true, true, true, true, false],
    timeRanges: "0900-1700",
    pomodoroEnabled: false,
    allowlistHard: []
  }, []);

  const runtime = Engine.normalizeRuntime({});
  const compiled = Engine.compileSiteMatchers(config.sites);

  const inWindow = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://x.com/home",
    now: epochAtLocal(2026, 1, 23, 10, 0)
  });

  const outWindow = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://x.com/home",
    now: epochAtLocal(2026, 1, 23, 20, 0)
  });

  assert.equal(inWindow.blocked, true);
  assert.equal(outWindow.blocked, false);
});

test("overnight schedule range crosses midnight", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "example.com",
    scheduleDays: [false, false, false, false, false, true, false], // Friday
    timeRanges: "2200-0200",
    pomodoroEnabled: false,
    allowlistHard: []
  }, []);

  const runtime = Engine.normalizeRuntime({});
  const compiled = Engine.compileSiteMatchers(config.sites);

  const fridayLate = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://example.com/",
    now: epochAtLocal(2026, 1, 20, 23, 30)
  });

  const saturdayEarly = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://example.com/",
    now: epochAtLocal(2026, 1, 21, 1, 15)
  });

  const saturdayLater = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://example.com/",
    now: epochAtLocal(2026, 1, 21, 3, 0)
  });

  assert.equal(fridayLate.blocked, true);
  assert.equal(saturdayEarly.blocked, true);
  assert.equal(saturdayLater.blocked, false);
});

test("limit blocks when usage exceeds budget", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "news.ycombinator.com",
    scheduleDays: [false, false, false, false, false, false, false],
    timeRanges: "",
    limitMinutes: 10,
    limitPeriod: "day",
    pomodoroEnabled: false,
    allowlistHard: []
  }, []);

  const runtime = Engine.normalizeRuntime({
    usageSecondsCurrentPeriod: 601,
    periodStartEpochSec: Engine.resolvePeriodStart(epochAtLocal(2026, 1, 23, 11, 0), "day")
  });

  const compiled = Engine.compileSiteMatchers(config.sites);
  const decision = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://news.ycombinator.com/",
    now: epochAtLocal(2026, 1, 23, 11, 0)
  });

  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, "blocked_limit");
});

test("hard allowlist always wins", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "canvas.calpoly.edu",
    scheduleDays: [true, true, true, true, true, true, true],
    timeRanges: "0000-2400",
    pomodoroEnabled: false,
    allowlistHard: ["canvas.calpoly.edu"]
  }, []);

  const runtime = Engine.normalizeRuntime({});
  const compiled = Engine.compileSiteMatchers(config.sites);
  const decision = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://canvas.calpoly.edu/courses/123",
    now: epochAtLocal(2026, 1, 23, 12, 0)
  });

  assert.equal(decision.blocked, false);
  assert.equal(decision.reason, "hard_allowlist");
});

test("non-blockable schemes are ignored", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "example.com",
    scheduleDays: [true, true, true, true, true, true, true],
    timeRanges: "0000-2400",
    pomodoroEnabled: false,
    allowlistHard: []
  }, []);

  const runtime = Engine.normalizeRuntime({});
  const compiled = Engine.compileSiteMatchers(config.sites);
  const decision = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "chrome://extensions",
    now: epochAtLocal(2026, 1, 23, 12, 0),
    extensionOrigin: "chrome-extension://abc/"
  });

  assert.equal(decision.blocked, false);
  assert.equal(decision.reason, "non_blockable_url");
});

test("pomodoro focus phase blocks matched sites", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "reddit.com",
    pomodoroEnabled: true,
    pomodoroFocusMinutes: 25,
    pomodoroBreakMinutes: 5,
    scheduleDays: [false, false, false, false, false, false, false],
    timeRanges: "",
    allowlistHard: []
  }, []);

  const started = Engine.startPomodoroSession(Engine.normalizeRuntime({}), config, epochAtLocal(2026, 1, 23, 10, 0));
  const compiled = Engine.compileSiteMatchers(config.sites);
  const decision = Engine.evaluateBlockingDecision({
    config,
    runtime: started,
    compiled,
    url: "https://www.reddit.com/",
    now: epochAtLocal(2026, 1, 23, 10, 5)
  });

  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, "blocked_pomodoro_focus");
  assert.equal(decision.pomodoro.phase, "focus");
});

test("pomodoro pauses at focus boundary and waits to start break", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "reddit.com",
    pomodoroEnabled: true,
    pomodoroFocusMinutes: 25,
    pomodoroBreakMinutes: 5,
    scheduleDays: [false, false, false, false, false, false, false],
    timeRanges: "",
    allowlistHard: []
  }, []);

  const runtime = Engine.normalizeRuntime({
    pomodoroActive: true,
    pomodoroPhase: "focus",
    pomodoroPhaseStartEpochSec: epochAtLocal(2026, 1, 23, 10, 0),
    pomodoroPhaseEndEpochSec: epochAtLocal(2026, 1, 23, 10, 25)
  });

  const compiled = Engine.compileSiteMatchers(config.sites);
  const decision = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://www.reddit.com/",
    now: epochAtLocal(2026, 1, 23, 10, 26)
  });

  assert.equal(decision.blocked, false);
  assert.equal(decision.reason, "pomodoro_paused");
  assert.equal(decision.pomodoro.active, false);
  assert.equal(decision.pomodoro.paused, true);
  assert.equal(decision.pomodoro.pendingPhase, "break");
});

test("pomodoro break phase allows matched sites when running", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "reddit.com",
    pomodoroEnabled: true,
    pomodoroFocusMinutes: 25,
    pomodoroBreakMinutes: 5,
    scheduleDays: [false, false, false, false, false, false, false],
    timeRanges: "",
    allowlistHard: []
  }, []);

  const runtime = Engine.normalizeRuntime({
    pomodoroActive: true,
    pomodoroPhase: "break",
    pomodoroPhaseStartEpochSec: epochAtLocal(2026, 1, 23, 10, 25),
    pomodoroPhaseEndEpochSec: epochAtLocal(2026, 1, 23, 10, 30)
  });

  const compiled = Engine.compileSiteMatchers(config.sites);
  const decision = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://www.reddit.com/",
    now: epochAtLocal(2026, 1, 23, 10, 27)
  });

  assert.equal(decision.blocked, false);
  assert.equal(decision.reason, "pomodoro_break");
  assert.equal(decision.pomodoro.phase, "break");
});

test("pomodoro pauses at break boundary and waits to start next focus", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "reddit.com",
    pomodoroEnabled: true,
    pomodoroFocusMinutes: 25,
    pomodoroBreakMinutes: 5,
    scheduleDays: [false, false, false, false, false, false, false],
    timeRanges: "",
    allowlistHard: []
  }, []);

  const runtime = Engine.normalizeRuntime({
    pomodoroActive: true,
    pomodoroPhase: "break",
    pomodoroPhaseStartEpochSec: epochAtLocal(2026, 1, 23, 10, 25),
    pomodoroPhaseEndEpochSec: epochAtLocal(2026, 1, 23, 10, 30)
  });

  const compiled = Engine.compileSiteMatchers(config.sites);
  const decision = Engine.evaluateBlockingDecision({
    config,
    runtime,
    compiled,
    url: "https://www.reddit.com/",
    now: epochAtLocal(2026, 1, 23, 10, 31)
  });

  assert.equal(decision.blocked, false);
  assert.equal(decision.reason, "pomodoro_paused");
  assert.equal(decision.pomodoro.active, false);
  assert.equal(decision.pomodoro.paused, true);
  assert.equal(decision.pomodoro.pendingPhase, "focus");
});

test("starting pomodoro from paused state resumes pending phase", () => {
  const config = Engine.normalizeConfig({
    enabled: true,
    sites: "reddit.com",
    pomodoroEnabled: true,
    pomodoroFocusMinutes: 25,
    pomodoroBreakMinutes: 5,
    allowlistHard: []
  }, []);

  const resumed = Engine.startPomodoroSession(Engine.normalizeRuntime({
    pomodoroPaused: true,
    pomodoroPendingPhase: "break"
  }), config, epochAtLocal(2026, 1, 23, 10, 26));

  assert.equal(resumed.pomodoroActive, true);
  assert.equal(resumed.pomodoroPaused, false);
  assert.equal(resumed.pomodoroPendingPhase, null);
  assert.equal(resumed.pomodoroPhase, "break");
});

test("pomodoro is enabled by default in normalized config", () => {
  const config = Engine.normalizeConfig({ enabled: true, sites: "reddit.com" }, []);
  assert.equal(config.pomodoroEnabled, true);
});
