import type { Metadata } from "next";
import Link from "next/link";
import { CHANGELOG, type ChangeRef } from "@/lib/changelog";
import { pageMeta } from "@/lib/site";

const REPO = "https://github.com/ejqs/downagain";

export const metadata: Metadata = pageMeta({
  title: "Grading changelog",
  description: "Every change to how downagain.dev grades incidents and providers, dated, with the pull request behind it.",
  path: "/about/changelog",
});

function refLink(r: ChangeRef) {
  return "pr" in r
    ? { href: `${REPO}/pull/${r.pr}`, label: `#${r.pr}` }
    : { href: `${REPO}/commit/${r.commit}`, label: r.commit };
}

function day(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function Changelog() {
  const days = [...new Set(CHANGELOG.map((c) => c.date))];
  return (
    <main className="wrap" style={{ paddingTop: 24 }}>
      <article className="prose">
        <h1 className="h1 sm">Grading changelog</h1>
        <p className="lede">Every change to the rubric, newest first. Current method: <Link href="/about">How it works</Link>.</p>
        {days.map((d) => (
          <section key={d} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 className="h2" id={d}>{day(d)}</h2>
            {CHANGELOG.filter((c) => c.date === d).map((c) => (
              <div key={c.title}>
                <p>
                  <strong>{c.title}</strong>{" "}
                  {c.refs.map((r) => {
                    const l = refLink(r);
                    return (
                      <a key={l.label} href={l.href} className="mono muted" style={{ fontSize: 13, marginLeft: 6 }}>
                        {l.label}
                      </a>
                    );
                  })}
                </p>
                <ul>
                  {c.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
