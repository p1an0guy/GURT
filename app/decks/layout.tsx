import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "GURT Flashcards Deck",
};

export default function DeckLayout({ children }: { children: ReactNode }) {
  return children;
}
