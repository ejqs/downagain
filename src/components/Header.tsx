"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Leaderboard", match: (p: string) => p === "/" || p.startsWith("/c/") || p.startsWith("/p/") },
  { href: "/incidents", label: "Incidents", match: (p: string) => p.startsWith("/incidents") },
  { href: "/compare", label: "Compare", match: (p: string) => p.startsWith("/compare") },
  { href: "/stack", label: "Stack", match: (p: string) => p.startsWith("/stack") },
  { href: "/about", label: "About", match: (p: string) => p.startsWith("/about") },
];

export function Logo() {
  return (
    <svg width="40" height="26" viewBox="0 0 44 28" aria-hidden="true">
      <path d="M2 14h10l4-10 6 20 4-10h4" fill="none" stroke="#0E0E10" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M32 14h10" fill="none" stroke="#E8590C" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Header() {
  const path = usePathname() ?? "/";
  return (
    <header className="site-header">
      <div className="wrap">
        <Link href="/" className="logo" aria-label="downagain.dev home">
          <Logo />
          <span>
            downagain<em>.dev</em>
          </span>
        </Link>
        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.match(path) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
