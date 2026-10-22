import type { Metadata } from "next";
import { GRADES } from "@/lib/grading";
import { SECURITY_PENALTY, TIER_BLURB, TIER_NAMES, TIER_WEIGHT } from "@/lib/severity";
import { USER_AGENT } from "@/lib/fetcher";

export const metadata: Metadata = { title: "How it works" };

export default function About() {
  return (
    <main className="wrap" style={{ paddingTop: 24 }}>
      <article className="prose">
        <h1 className="h1 sm">How it works</h1>
        <p className="lede">
          downagain.dev never pings anyone. Every 5 minutes it reads each provider&apos;s own public status page, stores what changed, and grades the
          track record with one rubric for everyone.
        </p>

        <h2 className="h2">Where the data comes from</h2>
        <ul>
          <li>Each provider&apos;s official status page API (Atlassian Statuspage JSON for most, Railway&apos;s and Heroku&apos;s own APIs for those two).</li>
          <li>
            We identify ourselves as <code className="mono">{USER_AGENT}</code>, use conditional requests, and back off when a page doesn&apos;t answer. A
            status page we can&apos;t reach makes a provider &quot;status unknown&quot;, never &quot;down&quot;.
          </li>
          <li>Every incident and every update posted on it is kept, even if the provider later edits or removes it from its own page.</li>
          <li>
            History starts with whatever each status API exposes (usually the last 50 incidents). Each provider page says how far back our records go.
          </li>
        </ul>

        <h2 className="h2" id="severity">Our severity tiers</h2>
        <p>
          Providers&apos; own labels (minor, major, critical) aren&apos;t consistent with each other. We grade every incident by one question: how badly did
          this hurt the people building on this provider?
        </p>
        <div className="tbl">
          <table>
            <tbody>
              <tr><th>Tier</th><th>What it means</th><th>Weight</th></tr>
              {[1, 2, 3, 4].map((t) => (
                <tr key={t}>
                  <td><strong>Sev {t} · {TIER_NAMES[t]}</strong></td>
                  <td>{TIER_BLURB[t]}</td>
                  <td className="mono">{TIER_WEIGHT[t]}</td>
                </tr>
              ))}
              <tr><td>Not counted</td><td>Scheduled maintenance inside its announced window</td><td className="mono">0</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          We map each status-page component to an area (production, shipping or dashboard) and combine it with how bad the provider said it was. A
          security incident moves up one tier, with Sev 2 as the floor, and adds {SECURITY_PENALTY} penalty points. Confirmed data loss or exposure is
          always Sev 1. Every incident page shows the reason it got its tier, and we can override a tier by hand after review.
        </p>

        <h2 className="h2">Grades</h2>
        <p>
          Each incident earns <strong>weight × minutes</strong>, counted from its start until the provider first says it&apos;s monitoring a fix (or resolves
          it). A provider&apos;s grade is the total over the same rolling 90 days for everyone, whatever history we hold.
        </p>
        <div className="tbl">
          <table>
            <tbody>
              <tr><th>Grade</th><th>Penalty points, 90 days</th></tr>
              {GRADES.map((g, k) => (
                <tr key={g.grade}>
                  <td><strong>{g.grade}</strong></td>
                  <td className="mono">{Number.isFinite(g.max) ? `${k === 0 ? 0 : GRADES[k - 1].max + 1}–${g.max.toLocaleString("en-US")}` : `${(GRADES[k - 1].max + 1).toLocaleString("en-US")}+`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Area grades use the same scale for each area alone. <strong>Admitted uptime</strong> counts only Sev 1 time the provider posted itself. Status
          pages can under-report, so treat it as a best case. Providers grade their own homework; we just add it up.
        </p>

        <h2 className="h2">The obvious question</h2>
        <p>Yes, downagain.dev is hosted on Railway, which is on our own leaderboard. When Railway is down, so are we.</p>

        <h2 className="h2">Missing something?</h2>
        <p>
          Suggest a provider or report a wrong grade on <a href="https://github.com/ejqs/downagain/issues">GitHub</a>. If you find this useful,{" "}
          <a href="https://buymeacoffee.com/ejqs">buy me a coffee</a>.
        </p>
      </article>
    </main>
  );
}
