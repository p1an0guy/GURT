export interface RuntimeSettings {
  baseUrl: string;
  useFixtures: boolean;
}

function defaultUseFixtures(): boolean {
  return (process.env.NEXT_PUBLIC_USE_FIXTURES ?? "true").toLowerCase() !== "false";
}

export function getDefaultRuntimeSettings(): RuntimeSettings {
  return {
    baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
    useFixtures: defaultUseFixtures(),
  };
}
