"use client";

import katex from "katex";
import "katex/contrib/mhchem";
import { useMemo } from "react";

/**
 * Renders text with inline LaTeX math ($...$ or \(...\))
 * and display math ($$...$$ or \[...\]).
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
  // Match $$...$$ or \[...\] (display) and $...$ or \(...\) (inline).
  // $...$ is treated as inline only when not part of $$...$$.
  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const matches: Array<{ match: RegExpMatchArray; isDisplay: boolean }> = [];
    const displayDollarMatch = remaining.match(/\$\$([\s\S]+?)\$\$/);
    if (displayDollarMatch) {
      matches.push({ match: displayDollarMatch, isDisplay: true });
    }

    const displayBracketMatch = remaining.match(/\\\[([\s\S]+?)\\\]/);
    if (displayBracketMatch) {
      matches.push({ match: displayBracketMatch, isDisplay: true });
    }

    const inlineDollarMatch = remaining.match(/(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+)\$(?!\$)/);
    if (inlineDollarMatch) {
      matches.push({ match: inlineDollarMatch, isDisplay: false });
    }

    const inlineParenMatch = remaining.match(/\\\(([\s\S]+?)\\\)/);
    if (inlineParenMatch) {
      matches.push({ match: inlineParenMatch, isDisplay: false });
    }

    if (matches.length === 0) {
      parts.push(escapeHtml(remaining));
      break;
    }

    let next = matches[0];
    for (const candidate of matches.slice(1)) {
      const nextIndex = next.match.index ?? Infinity;
      const candidateIndex = candidate.match.index ?? Infinity;
      if (candidateIndex < nextIndex) {
        next = candidate;
      }
    }

    const match = next.match;
    const isDisplay = next.isDisplay;
    const matchIndex = match.index ?? 0;

    // Add text before the match
    if (matchIndex > 0) {
      parts.push(escapeHtml(remaining.slice(0, matchIndex)));
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

    remaining = remaining.slice(matchIndex + match[0].length);
  }

  return parts.join("");
}
