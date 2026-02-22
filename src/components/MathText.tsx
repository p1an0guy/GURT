"use client";

import katex from "katex";
import { useMemo } from "react";

/**
 * Renders text with inline LaTeX math ($...$) and display math ($$...$$).
 * Non-math text is escaped as HTML. Invalid LaTeX is shown as-is.
 */
export function MathText({ text }: { text: string }) {
  const html = useMemo(() => renderMathInText(text), [text]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMathInText(text: string): string {
  // Match $$...$$ (display) and $...$ (inline), but not escaped \$
  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Try display math first: $$...$$
    const displayMatch = remaining.match(/\$\$([\s\S]+?)\$\$/);
    // Try inline math: $...$  (not preceded or followed by $)
    const inlineMatch = remaining.match(/(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+)\$(?!\$)/);

    let match: RegExpMatchArray | null = null;
    let isDisplay = false;

    if (displayMatch && inlineMatch) {
      if ((displayMatch.index ?? Infinity) <= (inlineMatch.index ?? Infinity)) {
        match = displayMatch;
        isDisplay = true;
      } else {
        match = inlineMatch;
      }
    } else if (displayMatch) {
      match = displayMatch;
      isDisplay = true;
    } else if (inlineMatch) {
      match = inlineMatch;
    }

    if (!match || match.index === undefined) {
      parts.push(escapeHtml(remaining));
      break;
    }

    // Add text before the match
    if (match.index > 0) {
      parts.push(escapeHtml(remaining.slice(0, match.index)));
    }

    // Render the LaTeX
    const latex = match[1];
    try {
      const rendered = katex.renderToString(latex, {
        displayMode: isDisplay,
        throwOnError: false,
        output: "html",
      });
      parts.push(rendered);
    } catch {
      // If KaTeX fails, show the original text
      parts.push(escapeHtml(match[0]));
    }

    remaining = remaining.slice(match.index + match[0].length);
  }

  return parts.join("");
}
