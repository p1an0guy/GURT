import type { ReactNode } from "react";

import "./globals.css";

export const metadata = {
  title: "GURT StudyBuddy Demo",
  description: "Hackathon demo shell for Canvas + Study + Calendar APIs",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
