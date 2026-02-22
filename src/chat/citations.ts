import type { ChatCitation, ChatResponse } from "../api/types.ts";

function isHttpsUrl(value: string): boolean {
  return value.startsWith("https://");
}

export function getRenderableChatCitations(response: ChatResponse): ChatCitation[] {
  const structured = (response.citationDetails ?? []).filter(
    (citation) =>
      citation.source.trim().length > 0 &&
      citation.label.trim().length > 0 &&
      isHttpsUrl(citation.url),
  );
  if (structured.length > 0) {
    return structured;
  }

  return response.citations
    .map((source) => source.trim())
    .filter((source) => isHttpsUrl(source))
    .map((source) => ({
      source,
      label: source,
      url: source,
    }));
}
