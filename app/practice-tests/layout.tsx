import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "GURT Practice Tests",
};

export default function PracticeTestsLayout({ children }: { children: ReactNode }) {
  return children;
}
