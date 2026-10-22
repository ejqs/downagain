import type { Metadata } from "next";
import { GRADES } from "@/lib/grading";
import { SECURITY_PENALTY, TIER_BLURB, TIER_NAMES, TIER_WEIGHT } from "@/lib/severity";
import { USER_AGENT } from "@/lib/fetcher";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "How it works",
  description: "Where the data comes from, how incidents get a severity, and how the 90-day grades are worked out.",
  path: "/about",
});

export default function About() {
  return (
    <main className="wrap" style={{ paddingTop: 24 }}>
      <article className="prose">
        <h1 className="h1 sm">How it works</h1>
        <p className="lede">
          We never ping anyone. Every 5 minutes we read each provider&apos;s public status page, keep what changed, and grade everyone on one rubric.
        </p>

        <h2 className="h2">Where the data comes from</h2>
        <ul>
          <li>Official status page APIs: Atlassian Statuspage for most, Railway&apos;s and Heroku&apos;s own for those two.</li>
          <li>
            User-Agent <code className="mono">{USER_AGENT}</code>, conditional requests, backoff on errors. An unreachable status page means
            &quot;status unknown&quot;, never &quot;down&quot;.
          </li>
          <li>Every incident and update is kept, even if the provider later edits or deletes it.</li>
          <li>History starts with whatever the status API exposes, usually the last 50 incidents. Provider pages show the start date.</li>
        </ul>

        <h2 className="h2" id="severity">Severity</h2>
        <p>Providers&apos; own labels don&apos;t agree with each other, so we use one question: how badly did this hurt the people building on it?</p>
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
          Tiers follow impact, not component names: a billing outage that freezes accounts can&apos;t ship, a slow docs page is a papercut. Security
          incidents move up one tier (Sev 2 at least) and add {SECURITY_PENALTY} penalty points. Confirmed data loss or exposure is always Sev 1.
          Every incident shows why it got its tier, and tiers can be corrected by hand.
        </p>
        <p>
          Rules grade first. Claude then reads every update the provider posted and refines it: what broke, how hard, how widely. One region or a
          slice of customers counts less than everyone. Those incidents say &ldquo;graded by Claude&rdquo;. A manual review always wins.
        </p>

        <h2 className="h2">Grades</h2>
        <p>
          Each incident scores <strong>weight × minutes</strong>, from start until the provider says it&apos;s monitoring a fix or resolved. Grades total
          the last 90 days, the same window for everyone.
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
          Two area grades use the same scale. <strong>PROD</strong>: your users are hit. <strong>SHIP</strong>: you can&apos;t deploy, build or
          manage, including dashboard, auth and billing outages. Papercuts count toward the overall grade only. <strong>Admitted uptime</strong> counts only Sev 1 time the provider posted
          itself, so it&apos;s a best case. Providers grade their own homework; we just add it up.
        </p>

        <h2 className="h2">The obvious question</h2>
        <p>Yes, we&apos;re hosted on Railway. When Railway is down, so are we.</p>

        <h2 className="h2">Missing something?</h2>
        <p>
          Suggest a provider or report a wrong grade on <a href="https://github.com/ejqs/downagain/issues">GitHub</a>. Made by{" "}
          <a href="https://ejqs.net">@ejqs</a>. Useful? <a href="https://buymeacoffee.com/ejqs">Buy me a coffee</a>.
        </p>
      </article>
    </main>
  );
}
