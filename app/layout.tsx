import type { ReactNode } from "react";

import AppShell from "./app-shell.tsx";
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
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
