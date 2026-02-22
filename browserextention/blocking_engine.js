(function (global) {
  "use strict";

  const DEFAULT_SET_NAME = "Focus Block Set";
  const DEFAULT_SCHEDULE_DAYS = [false, true, true, true, true, true, false];
  const DEFAULT_TIME_RANGES = "0900-1700";
  const DEFAULT_BLOCK_MODE = "redirect";
  const DEFAULT_POMODORO_FOCUS_MINUTES = 25;
  const DEFAULT_POMODORO_BREAK_MINUTES = 5;
  const BLOCKABLE_PROTOCOLS = new Set(["http:", "https:", "file:"]);

  function toUtcIsoString(date) {
    return (date instanceof Date ? date : new Date(date)).toISOString();
  }

  function nowEpochSec() {
    return Math.floor(Date.now() / 1000);
  }

  function uniqueStrings(values) {
    const out = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const normalized = String(value || "").trim().toLowerCase();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  function normalizeAllowlist(values, fallback = []) {
    const normalized = uniqueStrings(values);
    if (normalized.length > 0) {
      return normalized;
    }
    return uniqueStrings(fallback);
  }

  function normalizeScheduleDays(days) {
    if (!Array.isArray(days) || days.length !== 7) {
      return DEFAULT_SCHEDULE_DAYS.slice();
    }
    return days.map((value) => Boolean(value));
  }

  function normalizeLimitMinutes(limitMinutes) {
    if (limitMinutes === null || limitMinutes === undefined || limitMinutes === "") {
      return null;
    }
    const parsed = Number(limitMinutes);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.floor(parsed);
  }

  function normalizeLimitPeriod(limitPeriod) {
    return limitPeriod === "day" || limitPeriod === "week" ? limitPeriod : null;
  }

  function normalizePositiveMinutes(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.max(1, Math.floor(parsed));
  }

  function normalizePomodoroPhase(value) {
    return value === "focus" || value === "break" ? value : null;
  }

  function normalizeConfig(config, defaultAllowlist) {
    const source = config && typeof config === "object" ? config : {};
    return {
      version: 2,
      enabled: Boolean(source.enabled),
      setName: typeof source.setName === "string" && source.setName.trim()
        ? source.setName.trim()
        : DEFAULT_SET_NAME,
      sites: typeof source.sites === "string" ? source.sites : "",
      scheduleDays: normalizeScheduleDays(source.scheduleDays),
      timeRanges: typeof source.timeRanges === "string" && source.timeRanges.trim()
        ? source.timeRanges.trim()
        : DEFAULT_TIME_RANGES,
      limitMinutes: normalizeLimitMinutes(source.limitMinutes),
      limitPeriod: normalizeLimitPeriod(source.limitPeriod),
      blockMode: DEFAULT_BLOCK_MODE,
      allowlistHard: normalizeAllowlist(source.allowlistHard, defaultAllowlist),
      pomodoroEnabled: source.pomodoroEnabled === undefined ? true : Boolean(source.pomodoroEnabled),
      pomodoroFocusMinutes: normalizePositiveMinutes(source.pomodoroFocusMinutes, DEFAULT_POMODORO_FOCUS_MINUTES),
      pomodoroBreakMinutes: normalizePositiveMinutes(source.pomodoroBreakMinutes, DEFAULT_POMODORO_BREAK_MINUTES),
      updatedAt: typeof source.updatedAt === "string" && source.updatedAt
        ? source.updatedAt
        : toUtcIsoString(new Date())
    };
  }

  function normalizeRuntime(runtime) {
    const source = runtime && typeof runtime === "object" ? runtime : {};
    const usage = Number(source.usageSecondsCurrentPeriod);
    const periodStart = Number(source.periodStartEpochSec);
    const lastTick = Number(source.lastTickEpochSec);
    const phaseStart = Number(source.pomodoroPhaseStartEpochSec);
    const phaseEnd = Number(source.pomodoroPhaseEndEpochSec);

    return {
      usageSecondsCurrentPeriod: Number.isFinite(usage) && usage >= 0 ? Math.floor(usage) : 0,
      periodStartEpochSec: Number.isFinite(periodStart) && periodStart > 0 ? Math.floor(periodStart) : 0,
      lastTickEpochSec: Number.isFinite(lastTick) && lastTick > 0 ? Math.floor(lastTick) : 0,
      blockedTabIds: Array.isArray(source.blockedTabIds)
        ? source.blockedTabIds.filter((value) => Number.isInteger(value))
        : [],
      lastDecisionByTab: source.lastDecisionByTab && typeof source.lastDecisionByTab === "object"
        ? source.lastDecisionByTab
        : {},
      pomodoroActive: Boolean(source.pomodoroActive),
      pomodoroPhase: normalizePomodoroPhase(source.pomodoroPhase),
      pomodoroPhaseStartEpochSec: Number.isFinite(phaseStart) && phaseStart > 0 ? Math.floor(phaseStart) : 0,
      pomodoroPhaseEndEpochSec: Number.isFinite(phaseEnd) && phaseEnd > 0 ? Math.floor(phaseEnd) : 0,
      pomodoroPaused: Boolean(source.pomodoroPaused),
      pomodoroPendingPhase: normalizePomodoroPhase(source.pomodoroPendingPhase)
    };
  }

  function pomodoroDurationSec(config, phase) {
    if (phase === "break") {
      return Math.max(1, config.pomodoroBreakMinutes) * 60;
    }
    return Math.max(1, config.pomodoroFocusMinutes) * 60;
  }

  function stopPomodoroSession(runtime) {
    const next = normalizeRuntime(runtime);
    next.pomodoroActive = false;
    next.pomodoroPhase = null;
    next.pomodoroPhaseStartEpochSec = 0;
    next.pomodoroPhaseEndEpochSec = 0;
    next.pomodoroPaused = false;
    next.pomodoroPendingPhase = null;
    return next;
  }

  function startPomodoroPhase(runtime, config, phase, now = nowEpochSec()) {
    const next = normalizeRuntime(runtime);
    const normalizedPhase = normalizePomodoroPhase(phase) || "focus";
    next.pomodoroActive = true;
    next.pomodoroPhase = normalizedPhase;
    next.pomodoroPhaseStartEpochSec = now;
    next.pomodoroPhaseEndEpochSec = now + pomodoroDurationSec(config, normalizedPhase);
    next.pomodoroPaused = false;
    next.pomodoroPendingPhase = null;
    return next;
  }

  function startPomodoroSession(runtime, config, now = nowEpochSec()) {
    const next = normalizeRuntime(runtime);
    if (next.pomodoroPaused && next.pomodoroPendingPhase) {
      return startPomodoroPhase(next, config, next.pomodoroPendingPhase, now);
    }
    return startPomodoroPhase(next, config, "focus", now);
  }

  function advancePomodoroState(runtime, config, now = nowEpochSec()) {
    let next = normalizeRuntime(runtime);

    if (!config.pomodoroEnabled) {
      return stopPomodoroSession(next);
    }

    if (!next.pomodoroActive) {
      return next;
    }

    if (!next.pomodoroPhase || next.pomodoroPhaseEndEpochSec <= 0) {
      return startPomodoroSession(next, config, now);
    }

    if (now >= next.pomodoroPhaseEndEpochSec) {
      const upcomingPhase = next.pomodoroPhase === "focus" ? "break" : "focus";
      next.pomodoroActive = false;
      next.pomodoroPhase = null;
      next.pomodoroPhaseStartEpochSec = 0;
      next.pomodoroPhaseEndEpochSec = 0;
      next.pomodoroPaused = true;
      next.pomodoroPendingPhase = upcomingPhase;
    }

    return next;
  }

  function getPomodoroState(runtime, config, now = nowEpochSec()) {
    const normalized = normalizeRuntime(runtime);
    const active = Boolean(config.pomodoroEnabled && normalized.pomodoroActive && normalized.pomodoroPhase);
    const paused = Boolean(config.pomodoroEnabled && !active && normalized.pomodoroPaused && normalized.pomodoroPendingPhase);
    const remainingSeconds = active
      ? Math.max(0, normalized.pomodoroPhaseEndEpochSec - now)
      : 0;

    return {
      enabled: Boolean(config.pomodoroEnabled),
      active,
      phase: active ? normalized.pomodoroPhase : null,
      phaseStartEpochSec: active ? normalized.pomodoroPhaseStartEpochSec : 0,
      phaseEndEpochSec: active ? normalized.pomodoroPhaseEndEpochSec : 0,
      remainingSeconds,
      paused,
      pendingPhase: paused ? normalized.pomodoroPendingPhase : null
    };
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function hasWildcard(value) {
    return value.includes("*");
  }

  function globToRegex(glob) {
    const escaped = escapeRegex(glob).replace(/\\\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i");
  }

  function splitPattern(rawPattern) {
    const text = String(rawPattern || "").trim();
    if (!text) {
      return null;
    }
    const isAllow = text.startsWith("+");
    const pattern = isAllow ? text.slice(1).trim() : text;
    if (!pattern) {
      return null;
    }
    return { isAllow, pattern, raw: text };
  }

  function normalizePattern(pattern) {
    const trimmed = String(pattern || "").trim().toLowerCase();
    if (!trimmed) {
      return "";
    }
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }
    return trimmed.replace(/^[a-z]+:\/\//i, "");
  }

  function matcherFromPattern(pattern) {
    const normalized = normalizePattern(pattern);
    if (!normalized) {
      return null;
    }

    if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
      const fullRegex = hasWildcard(normalized) ? globToRegex(normalized) : null;
      return {
        raw: pattern,
        matches(urlInfo) {
          const href = urlInfo.href.toLowerCase();
          if (fullRegex) {
            return fullRegex.test(href);
          }
          return href.startsWith(normalized);
        }
      };
    }

    const withoutLeadingWildcardDot = normalized.startsWith("*.")
      ? normalized.slice(2)
      : normalized;

    const firstSlash = withoutLeadingWildcardDot.indexOf("/");
    const hostPart = firstSlash === -1
      ? withoutLeadingWildcardDot
      : withoutLeadingWildcardDot.slice(0, firstSlash);
    const pathPart = firstSlash === -1
      ? ""
      : withoutLeadingWildcardDot.slice(firstSlash);

    if (!hostPart) {
      return null;
    }

    const hostRegex = hasWildcard(hostPart) ? globToRegex(hostPart) : null;
    const pathRegex = pathPart && hasWildcard(pathPart) ? globToRegex(pathPart) : null;

    return {
      raw: pattern,
      matches(urlInfo) {
        const host = urlInfo.hostname.toLowerCase();
        let hostMatch = false;

        if (hostRegex) {
          hostMatch = hostRegex.test(host);
        } else {
          hostMatch = host === hostPart || host.endsWith(`.${hostPart}`);
        }

        if (!hostMatch) {
          return false;
        }

        if (!pathPart) {
          return true;
        }

        const pathValue = `${urlInfo.pathname}${urlInfo.search}`;
        if (pathRegex) {
          return pathRegex.test(pathValue);
        }

        return pathValue.startsWith(pathPart);
      }
    };
  }

  function compileSiteMatchers(sites) {
    const tokens = String(sites || "")
      .split(/[\s,]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    const blockMatchers = [];
    const allowMatchers = [];
    const validationErrors = [];

    for (const token of tokens) {
      const split = splitPattern(token);
      if (!split) {
        continue;
      }

      const matcher = matcherFromPattern(split.pattern);
      if (!matcher) {
        validationErrors.push(`Invalid site pattern: ${token}`);
        continue;
      }

      if (split.isAllow) {
        allowMatchers.push({ raw: split.raw, matcher });
      } else {
        blockMatchers.push({ raw: split.raw, matcher });
      }
    }

    return {
      blockMatchers,
      allowMatchers,
      validationErrors
    };
  }

  function parseUrlInfo(url) {
    try {
      const parsed = new URL(url);
      return {
        href: parsed.toString(),
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        pathname: parsed.pathname,
        search: parsed.search
      };
    } catch {
      return null;
    }
  }

  function isBlockableUrl(url, extensionOrigin) {
    const info = parseUrlInfo(url);
    if (!info) {
      return false;
    }
    if (!BLOCKABLE_PROTOCOLS.has(info.protocol)) {
      return false;
    }
    if (extensionOrigin && info.href.startsWith(extensionOrigin)) {
      return false;
    }
    return true;
  }

  function hostMatchesAllowlist(hostname, allowlistHard) {
    const host = String(hostname || "").toLowerCase();
    if (!host) {
      return false;
    }

    for (const entry of allowlistHard) {
      const token = String(entry || "").toLowerCase().trim();
      if (!token) {
        continue;
      }
      if (token.startsWith("*.")) {
        const domain = token.slice(2);
        if (host === domain || host.endsWith(`.${domain}`)) {
          return true;
        }
      } else if (host === token || host.endsWith(`.${token}`)) {
        return true;
      }
    }

    return false;
  }

  function findFirstMatcher(matchers, urlInfo) {
    for (const candidate of matchers) {
      if (candidate.matcher.matches(urlInfo)) {
        return candidate.raw;
      }
    }
    return null;
  }

  function parseTimeRanges(value) {
    const text = String(value || "").trim();
    if (!text) {
      return { ranges: [], errors: [] };
    }

    const entries = text
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    const ranges = [];
    const errors = [];

    for (const entry of entries) {
      const match = entry.match(/^(\d{4})-(\d{4})$/);
      if (!match) {
        errors.push(`Invalid time range '${entry}' (expected HHMM-HHMM).`);
        continue;
      }

      const startValue = Number(match[1]);
      const endValue = Number(match[2]);
      const startHour = Math.floor(startValue / 100);
      const startMinute = startValue % 100;
      const endHour = Math.floor(endValue / 100);
      const endMinute = endValue % 100;

      if (
        startHour > 23 ||
        endHour > 24 ||
        startMinute > 59 ||
        endMinute > 59 ||
        (endHour === 24 && endMinute !== 0) ||
        (startHour === 24 && startMinute !== 0)
      ) {
        errors.push(`Invalid time value in '${entry}'.`);
        continue;
      }

      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;

      if (startMinutes === endMinutes) {
        errors.push(`Time range '${entry}' cannot have equal start and end.`);
        continue;
      }

      ranges.push({
        raw: entry,
        startMinutes,
        endMinutes,
        wrapsMidnight: endMinutes < startMinutes
      });
    }

    return { ranges, errors };
  }

  function getDayMinutes(nowEpochSec) {
    const date = new Date(nowEpochSec * 1000);
    return {
      day: date.getDay(),
      minuteOfDay: date.getHours() * 60 + date.getMinutes(),
      second: date.getSeconds()
    };
  }

  function resolvePeriodStart(nowEpochSec, period) {
    const date = new Date(nowEpochSec * 1000);
    if (period === "week") {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - start.getDay());
      return Math.floor(start.getTime() / 1000);
    }

    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    return Math.floor(dayStart.getTime() / 1000);
  }

  function computePeriodEnd(periodStartEpochSec, period) {
    if (!periodStartEpochSec) {
      return 0;
    }
    if (period === "week") {
      return periodStartEpochSec + 7 * 24 * 60 * 60;
    }
    return periodStartEpochSec + 24 * 60 * 60;
  }

  function isNowInSchedule(nowEpochSec, scheduleDays, ranges) {
    if (!Array.isArray(ranges) || ranges.length === 0) {
      return { inSchedule: false, nextUnblockAtEpochSec: 0 };
    }

    const { day, minuteOfDay, second } = getDayMinutes(nowEpochSec);
    let matched = false;
    let nextUnblockAtEpochSec = 0;

    for (const range of ranges) {
      if (range.wrapsMidnight) {
        const prevDay = (day + 6) % 7;
        const activeForPreviousDay = scheduleDays[prevDay] && minuteOfDay < range.endMinutes;
        const activeForCurrentDay = scheduleDays[day] && minuteOfDay >= range.startMinutes;

        if (activeForPreviousDay || activeForCurrentDay) {
          matched = true;
          const endToday = minuteOfDay < range.endMinutes;
          const minutesRemaining = endToday
            ? range.endMinutes - minuteOfDay
            : (24 * 60 - minuteOfDay) + range.endMinutes;
          const candidate = nowEpochSec + (minutesRemaining * 60) - second;
          if (!nextUnblockAtEpochSec || candidate < nextUnblockAtEpochSec) {
            nextUnblockAtEpochSec = candidate;
          }
        }
      } else if (scheduleDays[day] && minuteOfDay >= range.startMinutes && minuteOfDay < range.endMinutes) {
        matched = true;
        const minutesRemaining = range.endMinutes - minuteOfDay;
        const candidate = nowEpochSec + (minutesRemaining * 60) - second;
        if (!nextUnblockAtEpochSec || candidate < nextUnblockAtEpochSec) {
          nextUnblockAtEpochSec = candidate;
        }
      }
    }

    return { inSchedule: matched, nextUnblockAtEpochSec };
  }

  function updateRuntimeForPeriod(runtime, config, now) {
    const normalizedRuntime = normalizeRuntime(runtime);
    const period = normalizeLimitPeriod(config.limitPeriod);
    if (!period || !config.limitMinutes) {
      return normalizedRuntime;
    }

    const expectedStart = resolvePeriodStart(now, period);
    if (normalizedRuntime.periodStartEpochSec !== expectedStart) {
      normalizedRuntime.periodStartEpochSec = expectedStart;
      normalizedRuntime.usageSecondsCurrentPeriod = 0;
    }

    return normalizedRuntime;
  }

  function computeNextUnblock(blockedForSchedule, scheduleUnblock, blockedForLimit, limitUnblock) {
    if (blockedForSchedule && blockedForLimit) {
      return Math.max(scheduleUnblock || 0, limitUnblock || 0);
    }
    if (blockedForSchedule) {
      return scheduleUnblock || 0;
    }
    if (blockedForLimit) {
      return limitUnblock || 0;
    }
    return 0;
  }

  function evaluateBlockingDecision(input) {
    const {
      config,
      runtime,
      compiled,
      url,
      now,
      extensionOrigin
    } = input;

    const nowEpoch = Number.isFinite(now) ? Math.floor(now) : nowEpochSec();
    const normalizedConfig = normalizeConfig(config, []);
    let runtimeWithState = updateRuntimeForPeriod(runtime, normalizedConfig, nowEpoch);
    runtimeWithState = advancePomodoroState(runtimeWithState, normalizedConfig, nowEpoch);
    const pomodoro = getPomodoroState(runtimeWithState, normalizedConfig, nowEpoch);

    const baseDecision = {
      blocked: false,
      reason: "allowed",
      matchedPattern: null,
      nextUnblockAtEpochSec: 0,
      timeRemainingSec: null,
      activeRuleSummary: "Not blocked",
      runtime: runtimeWithState,
      pomodoro,
      trackable: false
    };

    if (!normalizedConfig.enabled) {
      return {
        ...baseDecision,
        reason: "blocking_disabled",
        activeRuleSummary: "Blocking is disabled"
      };
    }

    if (!isBlockableUrl(url, extensionOrigin)) {
      return {
        ...baseDecision,
        reason: "non_blockable_url",
        activeRuleSummary: "Open a normal website tab to evaluate blocking."
      };
    }

    const urlInfo = parseUrlInfo(url);
    if (!urlInfo) {
      return {
        ...baseDecision,
        reason: "invalid_url",
        activeRuleSummary: "URL is invalid"
      };
    }

    if (hostMatchesAllowlist(urlInfo.hostname, normalizedConfig.allowlistHard)) {
      return {
        ...baseDecision,
        reason: "hard_allowlist",
        activeRuleSummary: "Domain is in protected allowlist"
      };
    }

    const compiledMatchers = compiled || compileSiteMatchers(normalizedConfig.sites);
    const matchedBlock = findFirstMatcher(compiledMatchers.blockMatchers, urlInfo);
    if (!matchedBlock) {
      return {
        ...baseDecision,
        reason: "no_site_match",
        activeRuleSummary: "No blocking rule matched"
      };
    }

    const matchedAllow = findFirstMatcher(compiledMatchers.allowMatchers, urlInfo);
    if (matchedAllow) {
      return {
        ...baseDecision,
        reason: "allow_rule_match",
        matchedPattern: matchedAllow,
        activeRuleSummary: `Allowed by exception (${matchedAllow})`,
        trackable: false
      };
    }

    if (normalizedConfig.pomodoroEnabled) {
      if (pomodoro.paused && pomodoro.pendingPhase) {
        const nextLabel = pomodoro.pendingPhase === "focus" ? "focus" : "break";
        return {
          ...baseDecision,
          reason: "pomodoro_paused",
          matchedPattern: matchedBlock,
          activeRuleSummary: `Phase complete; start ${nextLabel} when ready (${matchedBlock})`,
          trackable: false
        };
      }

      if (!pomodoro.active) {
        return {
          ...baseDecision,
          reason: "pomodoro_idle",
          matchedPattern: matchedBlock,
          activeRuleSummary: `Pomodoro enabled; start a session to block (${matchedBlock})`,
          trackable: false
        };
      }

      if (pomodoro.phase === "focus") {
        return {
          ...baseDecision,
          blocked: true,
          reason: "blocked_pomodoro_focus",
          matchedPattern: matchedBlock,
          nextUnblockAtEpochSec: pomodoro.phaseEndEpochSec,
          timeRemainingSec: Math.max(0, pomodoro.phaseEndEpochSec - nowEpoch),
          activeRuleSummary: `Focus session active (${matchedBlock})`,
          trackable: true
        };
      }

      return {
        ...baseDecision,
        reason: "pomodoro_break",
        matchedPattern: matchedBlock,
        nextUnblockAtEpochSec: pomodoro.phaseEndEpochSec,
        timeRemainingSec: Math.max(0, pomodoro.phaseEndEpochSec - nowEpoch),
        activeRuleSummary: `Break session active (${matchedBlock})`,
        trackable: false
      };
    }

    const parsedRanges = parseTimeRanges(normalizedConfig.timeRanges);
    const schedule = isNowInSchedule(nowEpoch, normalizedConfig.scheduleDays, parsedRanges.ranges);

    const hasLimit = Boolean(normalizedConfig.limitMinutes && normalizedConfig.limitPeriod);
    const limitSeconds = hasLimit ? normalizedConfig.limitMinutes * 60 : 0;
    const usageSeconds = runtimeWithState.usageSecondsCurrentPeriod;
    const blockedForLimit = hasLimit && usageSeconds >= limitSeconds;
    const periodEnd = hasLimit
      ? computePeriodEnd(resolvePeriodStart(nowEpoch, normalizedConfig.limitPeriod), normalizedConfig.limitPeriod)
      : 0;

    const blockedForSchedule = schedule.inSchedule;
    const blocked = blockedForSchedule || blockedForLimit;
    const nextUnblock = computeNextUnblock(
      blockedForSchedule,
      schedule.nextUnblockAtEpochSec,
      blockedForLimit,
      periodEnd
    );

    const reason = blocked
      ? blockedForSchedule && blockedForLimit
        ? "blocked_schedule_and_limit"
        : blockedForSchedule
          ? "blocked_schedule"
          : "blocked_limit"
      : "allowed_rule_not_active";

    const summary = blocked
      ? blockedForSchedule && blockedForLimit
        ? `Blocked by schedule and limit (${matchedBlock})`
        : blockedForSchedule
          ? `Blocked by schedule (${matchedBlock})`
          : `Blocked by time limit (${matchedBlock})`
      : `Matched site rule but currently allowed (${matchedBlock})`;

    return {
      ...baseDecision,
      blocked,
      reason,
      matchedPattern: matchedBlock,
      nextUnblockAtEpochSec: nextUnblock,
      timeRemainingSec: nextUnblock ? Math.max(0, nextUnblock - nowEpoch) : null,
      activeRuleSummary: summary,
      trackable: true
    };
  }

  function validateConfig(config) {
    const normalized = normalizeConfig(config, []);
    const errors = [];

    const parsedRanges = parseTimeRanges(normalized.timeRanges);
    errors.push(...parsedRanges.errors);

    const compiled = compileSiteMatchers(normalized.sites);
    errors.push(...compiled.validationErrors);

    const hasSites = compiled.blockMatchers.length > 0;
    const hasSchedule = parsedRanges.ranges.length > 0 && normalized.scheduleDays.some(Boolean);
    const hasLimit = Boolean(normalized.limitMinutes && normalized.limitPeriod);

    if (normalized.limitMinutes !== null && normalized.limitMinutes <= 0) {
      errors.push("Limit minutes must be a positive number.");
    }

    if (normalized.pomodoroEnabled) {
      const rawFocus = Number(
        config && config.pomodoroFocusMinutes !== undefined
          ? config.pomodoroFocusMinutes
          : normalized.pomodoroFocusMinutes
      );
      const rawBreak = Number(
        config && config.pomodoroBreakMinutes !== undefined
          ? config.pomodoroBreakMinutes
          : normalized.pomodoroBreakMinutes
      );
      if (!Number.isFinite(rawFocus) || rawFocus <= 0) {
        errors.push("Pomodoro focus minutes must be a positive number.");
      }
      if (!Number.isFinite(rawBreak) || rawBreak <= 0) {
        errors.push("Pomodoro break minutes must be a positive number.");
      }
    }

    if (normalized.enabled) {
      if (!hasSites) {
        errors.push("Add at least one blocked site pattern.");
      }
      if (!hasSchedule && !hasLimit && !normalized.pomodoroEnabled) {
        errors.push("Enable at least one blocking condition (schedule, time limit, or Pomodoro)." );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      normalized,
      compiled,
      parsedRanges,
      hasSites,
      hasSchedule,
      hasLimit
    };
  }

  const api = {
    DEFAULT_SET_NAME,
    DEFAULT_SCHEDULE_DAYS,
    DEFAULT_TIME_RANGES,
    DEFAULT_BLOCK_MODE,
    DEFAULT_POMODORO_FOCUS_MINUTES,
    DEFAULT_POMODORO_BREAK_MINUTES,
    nowEpochSec,
    normalizeConfig,
    normalizeRuntime,
    compileSiteMatchers,
    parseTimeRanges,
    isNowInSchedule,
    resolvePeriodStart,
    computePeriodEnd,
    isBlockableUrl,
    hostMatchesAllowlist,
    evaluateBlockingDecision,
    validateConfig,
    updateRuntimeForPeriod,
    startPomodoroSession,
    stopPomodoroSession,
    advancePomodoroState,
    getPomodoroState
  };

  global.GurtBlockingEngine = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
