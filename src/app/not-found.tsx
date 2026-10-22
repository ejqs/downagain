import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap">
      <div className="section empty stack">
        <strong style={{ fontSize: 24 }}>404. This page is down. Permanently.</strong>
        <span>
          Try the <Link href="/">leaderboard</Link> instead.
        </span>
      </div>
    </main>
  );
}
