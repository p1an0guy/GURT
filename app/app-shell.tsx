"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
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

function StudyGuidesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 37 31" fill="none" {...props}>
      <path
        d="M34.1381 0H2.51544C1.8483 0 1.20849 0.254025 0.736755 0.706191C0.265019 1.15836 4.83876e-08 1.77163 4.83876e-08 2.41109V29.9664C-5.49932e-05 30.1425 0.0468487 30.3157 0.136259 30.4695C0.225669 30.6234 0.354618 30.7528 0.510866 30.8454C0.667113 30.9381 0.845473 30.9909 1.02901 30.9989C1.21256 31.0069 1.39519 30.9699 1.55957 30.8912L6.82762 28.3664L12.0957 30.8912C12.2452 30.9627 12.4101 31 12.5772 31C12.7443 31 12.9092 30.9627 13.0587 30.8912L18.3268 28.3664L23.5948 30.8912C23.7444 30.9627 23.9092 31 24.0763 31C24.2435 31 24.4083 30.9627 24.5579 30.8912L29.8259 28.3664L35.094 30.8912C35.2435 30.9626 35.4084 30.9998 35.5755 30.9997C35.7756 31 35.9717 30.9463 36.1415 30.8447C36.2978 30.7522 36.4269 30.623 36.5166 30.4693C36.6062 30.3156 36.6533 30.1425 36.6535 29.9664V2.41109C36.6535 1.77163 36.3885 1.15836 35.9168 0.706191C35.445 0.254025 34.8052 0 34.1381 0ZM34.4975 28.2941L30.3074 26.286C30.1579 26.2145 29.9931 26.1772 29.8259 26.1772C29.6588 26.1772 29.4939 26.2145 29.3444 26.286L24.0763 28.8108L18.8083 26.286C18.6588 26.2145 18.4939 26.1772 18.3268 26.1772C18.1596 26.1772 17.9948 26.2145 17.8452 26.286L12.5772 28.8108L7.30915 26.286C7.15961 26.2145 6.99476 26.1772 6.82762 26.1772C6.66048 26.1772 6.49563 26.2145 6.34609 26.286L2.15609 28.2941V2.41109C2.15609 2.31974 2.19395 2.23213 2.26134 2.16753C2.32873 2.10293 2.42013 2.06665 2.51544 2.06665H34.1381C34.2334 2.06665 34.3248 2.10293 34.3922 2.16753C34.4596 2.23213 34.4975 2.31974 34.4975 2.41109V28.2941ZM13.542 8.83319C13.4526 8.66124 13.315 8.51658 13.1445 8.41547C12.9741 8.31436 12.7776 8.2608 12.5772 8.2608C12.3768 8.2608 12.1803 8.31436 12.0098 8.41547C11.8394 8.51658 11.7018 8.66124 11.6123 8.83319L5.86277 19.8553C5.79954 19.9767 5.76188 20.1089 5.75194 20.2443C5.74201 20.3797 5.76 20.5157 5.80488 20.6444C5.84976 20.7732 5.92065 20.8922 6.01352 20.9946C6.10638 21.0971 6.21939 21.1811 6.34609 21.2417C6.4728 21.3023 6.61072 21.3384 6.75198 21.3479C6.89324 21.3574 7.03507 21.3402 7.16938 21.2972C7.30369 21.2542 7.42784 21.1862 7.53475 21.0972C7.64166 21.0082 7.72924 20.8999 7.79247 20.7784L8.93161 18.5998H16.2228L17.3619 20.7836C17.4896 21.0288 17.7138 21.2155 17.985 21.3023C18.2563 21.3892 18.5524 21.3693 18.8083 21.2468C19.0642 21.1244 19.2589 20.9096 19.3495 20.6496C19.4402 20.3896 19.4193 20.1057 19.2916 19.8605L13.542 8.83319ZM10.0097 16.5332L12.5772 11.6111L15.1447 16.5332H10.0097ZM30.904 14.811C30.904 15.085 30.7904 15.3478 30.5882 15.5416C30.386 15.7354 30.1118 15.8443 29.8259 15.8443H26.5918V18.9443C26.5918 19.2183 26.4782 19.4811 26.276 19.6749C26.0739 19.8687 25.7997 19.9776 25.5137 19.9776C25.2278 19.9776 24.9536 19.8687 24.7514 19.6749C24.5493 19.4811 24.4357 19.2183 24.4357 18.9443V15.8443H21.2016C20.9156 15.8443 20.6414 15.7354 20.4393 15.5416C20.2371 15.3478 20.1235 15.085 20.1235 14.811C20.1235 14.5369 20.2371 14.2741 20.4393 14.0803C20.6414 13.8865 20.9156 13.7776 21.2016 13.7776H24.4357V10.6777C24.4357 10.4036 24.5493 10.1408 24.7514 9.947C24.9536 9.75322 25.2278 9.64435 25.5137 9.64435C25.7997 9.64435 26.0739 9.75322 26.276 9.947C26.4782 10.1408 26.5918 10.4036 26.5918 10.6777V13.7776H29.8259C30.1118 13.7776 30.386 13.8865 30.5882 14.0803C30.7904 14.2741 30.904 14.5369 30.904 14.811Z"
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

function CalendarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3.5v3" />
      <path d="M16 3.5v3" />
      <path d="M3.5 10h17" />
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
    matches: (pathname) => pathname === "/flashcards" || pathname.startsWith("/decks/"),
  },
  {
    href: "/study-guides",
    label: "Study Guides",
    Icon: StudyGuidesIcon,
    matches: (pathname) => pathname === "/study-guides",
  },
  {
    href: "/practice-tests",
    label: "Practice Tests",
    Icon: PracticeTestsIcon,
    matches: (pathname) => pathname === "/practice-tests",
  },
  {
    href: "/calendar",
    label: "Calendar",
    Icon: CalendarIcon,
    matches: (pathname) => pathname === "/calendar",
  },
  {
    href: "/chat",
    label: "Chat",
    Icon: ChatIcon,
    matches: (pathname) => pathname === "/chat",
  },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const activePath = useMemo(() => pathname ?? "", [pathname]);

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
          <span className="sidebar-avatar" aria-hidden="true" />
          <span className="sidebar-title">GURT</span>
        </Link>

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
