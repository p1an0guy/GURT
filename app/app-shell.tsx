"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode, SVGProps } from "react";

type NavItem = {
  href: string;
  label: string;
  Icon: (props: SVGProps<SVGSVGElement>) => ReactNode;
  matches: (pathname: string) => boolean;
};

function FlashcardsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 36 35" fill="none" {...props}>
      <path
        d="M32.9548 11.9149H2.65153C1.9483 11.9149 1.27388 12.1895 0.776616 12.6783C0.279357 13.1671 0 13.83 0 14.5213V32.3936C0 33.0849 0.279357 33.7478 0.776616 34.2366C1.27388 34.7254 1.9483 35 2.65153 35H32.9548C33.658 35 34.3324 34.7254 34.8297 34.2366C35.3269 33.7478 35.6063 33.0849 35.6063 32.3936V14.5213C35.6063 13.83 35.3269 13.1671 34.8297 12.6783C34.3324 12.1895 33.658 11.9149 32.9548 11.9149ZM33.3336 32.3936C33.3336 32.4924 33.2937 32.5871 33.2226 32.6569C33.1516 32.7267 33.0552 32.766 32.9548 32.766H2.65153C2.55107 32.766 2.45472 32.7267 2.38369 32.6569C2.31265 32.5871 2.27274 32.4924 2.27274 32.3936V14.5213C2.27274 14.4225 2.31265 14.3278 2.38369 14.258C2.45472 14.1882 2.55107 14.1489 2.65153 14.1489H32.9548C33.0552 14.1489 33.1516 14.1882 33.2226 14.258C33.2937 14.3278 33.3336 14.4225 33.3336 14.5213V32.3936ZM3.03032 7.07447C3.03032 6.77822 3.15005 6.4941 3.36316 6.28461C3.57627 6.07513 3.86531 5.95745 4.16669 5.95745H31.4396C31.741 5.95745 32.03 6.07513 32.2431 6.28461C32.4563 6.4941 32.576 6.77822 32.576 7.07447C32.576 7.37072 32.4563 7.65484 32.2431 7.86432C32.03 8.0738 31.741 8.19149 31.4396 8.19149H4.16669C3.86531 8.19149 3.57627 8.0738 3.36316 7.86432C3.15005 7.65484 3.03032 7.37072 3.03032 7.07447ZM6.06065 1.11702C6.06065 0.820769 6.18037 0.53665 6.39348 0.327168C6.60659 0.117686 6.89563 0 7.19702 0H28.4093C28.7107 0 28.9997 0.117686 29.2128 0.327168C29.4259 0.53665 29.5457 0.820769 29.5457 1.11702C29.5457 1.41327 29.4259 1.69739 29.2128 1.90687C28.9997 2.11636 28.7107 2.23404 28.4093 2.23404H7.19702C6.89563 2.23404 6.60659 2.11636 6.39348 1.90687C6.18037 1.69739 6.06065 1.41327 6.06065 1.11702Z"
        fill="currentColor"
      />
    </svg>
  );
}

function PracticeTestsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="M12 8l4 4" />
    </svg>
  );
}

function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M4 5.5h16v10.5H9l-5 4v-4H4V5.5z" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/flashcards",
    label: "Flashcards",
    Icon: FlashcardsIcon,
    matches: (pathname) => pathname === "/flashcards" || pathname === "/decks",
  },
  {
    href: "/practice-tests",
    label: "Practice Tests",
    Icon: PracticeTestsIcon,
    matches: (pathname) => pathname === "/practice-tests",
  },
  {
    href: "/chat",
    label: "Chat",
    Icon: ChatIcon,
    matches: (pathname) => pathname === "/chat",
  },
];

const THEME_STORAGE_KEY = "gurt-theme";
type Theme = "dark" | "light";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");

  const activePath = useMemo(() => pathname ?? "", [pathname]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  function toggleTheme(): void {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }

  return (
    <div className="app-shell">
      <button
        type="button"
        className="mobile-nav-trigger"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls="sidebarNav"
      >
        Menu
      </button>
      {isOpen ? <button type="button" className="sidebar-overlay" onClick={() => setIsOpen(false)} aria-label="Close menu" /> : null}

      <aside id="sidebarNav" className={`app-sidebar ${isOpen ? "open" : ""}`}>
        <Link href="/" className="sidebar-brand" onClick={() => setIsOpen(false)}>
          <span className="sidebar-avatar" aria-hidden="true">
            <span className="sidebar-logo" />
          </span>
          <span className="sidebar-title">GURT</span>
        </Link>
        <button
          type="button"
          className={`theme-toggle ${theme === "light" ? "light" : ""}`}
          onClick={toggleTheme}
          aria-pressed={theme === "light"}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          <span className="theme-toggle-track" aria-hidden="true">
            <span className="theme-toggle-thumb" />
          </span>
          <span className="theme-toggle-label">{theme === "dark" ? "Dark mode" : "Light mode"}</span>
        </button>

        <nav className="sidebar-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-nav-item ${item.matches(activePath) ? "active" : ""}`}
              onClick={() => setIsOpen(false)}
            >
              <span className="sidebar-icon" aria-hidden="true">
                <item.Icon width="28" height="28" />
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <div className="app-content">{children}</div>
    </div>
  );
}
