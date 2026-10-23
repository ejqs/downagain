import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap">
      <div className="section empty stack">
        <strong style={{ fontSize: 24 }}>404. Nothing here.</strong>
        <span>
          <Link href="/">Back to the leaderboard</Link>
        </span>
      </div>
    </main>
  );
}
