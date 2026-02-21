export interface RuntimeSettings {
  baseUrl: string;
  useFixtures: boolean;
}

const STORAGE_KEY = "gurt.runtimeSettings.v1";

function defaultUseFixtures(): boolean {
  return (process.env.NEXT_PUBLIC_USE_FIXTURES ?? "true").toLowerCase() !== "false";
}

export function getDefaultRuntimeSettings(): RuntimeSettings {
  return {
    baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
    useFixtures: defaultUseFixtures(),
  };
}

export function readRuntimeSettings(): RuntimeSettings {
  const defaults = getDefaultRuntimeSettings();
  if (typeof window === "undefined") {
    return defaults;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeSettings>;
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : defaults.baseUrl,
      useFixtures: typeof parsed.useFixtures === "boolean" ? parsed.useFixtures : defaults.useFixtures,
    };
  } catch {
    return defaults;
  }
}

export function writeRuntimeSettings(value: RuntimeSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      baseUrl: value.baseUrl.trim(),
      useFixtures: value.useFixtures,
    }),
  );
}
