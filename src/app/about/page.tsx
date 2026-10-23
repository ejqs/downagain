import type { Metadata } from "next";
import { GRADES } from "@/lib/grading";
import { SCOPE_BLURB, SCOPE_WEIGHT, SECURITY_PENALTY, TIER_BLURB, TIER_NAMES, TIER_WEIGHT, type Scope } from "@/lib/severity";
import { USER_AGENT } from "@/lib/fetcher";
import { SITE, SITE_NAME, absUrl, pageMeta } from "@/lib/site";
import { JsonLd } from "@/components/JsonLd";
import { STALE_AFTER_DAYS, WORKLOADS, isPriced } from "@/lib/pricing";
import { CATEGORIES } from "@/lib/providers";

const SCOPE_ORDER: Scope[] = ["global", "unclear", "regional", "subset", "single", "local"];

export const metadata: Metadata = pageMeta({
  title: "How it works",
  description: "Where the data comes from, how incidents get a severity, and how the 90-day grades are worked out.",
  path: "/about",
});

const DATASET_LD = {
  "@context": "https://schema.org",
  "@type": "Dataset",
  name: "Hosting, cloud, database and AI API incident history",
  description:
    "Incidents posted on the official status pages of hosting platforms, clouds, databases, dev tools and APIs, polled every 5 minutes, with a severity tier, duration and 90-day grade for each provider.",
  url: absUrl("/about"),
  creator: { "@type": "Person", name: "ejqs", url: "https://ejqs.net" },
  includedInDataCatalog: { "@type": "DataCatalog", name: SITE_NAME, url: `${SITE}/` },
  isAccessibleForFree: true,
  license: "https://opensource.org/license/mit",
  keywords: ["uptime", "outages", "status page", "incidents", "hosting", "AI API"],
  distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: absUrl("/api/status.json") }],
};

export default function About() {
  return (
    <main className="wrap" style={{ paddingTop: 24 }}>
      <JsonLd data={DATASET_LD} />
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
          <li>
            User reports come from visitors who tap &quot;Down for me&quot; and pass a Cloudflare Turnstile check. One per visitor per provider every 30
            minutes. They show on provider pages and never count toward a grade. We keep a hash of your IP that changes daily, never the IP.
          </li>
          <li>
            The whole board as JSON: <a href="/api/status.json" className="mono">/api/status.json</a>. Free to use. A link back is plenty.
          </li>
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
          A cloud incident the provider confines to one region tops out at Sev 2.
          Every incident shows why it got its tier, and tiers can be corrected by hand.
        </p>
        <p>
          Rules grade first. Claude then reads every update the provider posted and refines it: what broke, how hard, how widely. One region or a
          slice of customers counts less than everyone. Those incidents are tagged AI-graded, and long ones get a short summary from Claude. Open
          &ldquo;Why this grade&rdquo; on any of them for the rules&apos; call, Claude&apos;s call, the model and date, and the raw record: exactly what
          Claude read and answered. A manual review always wins.
        </p>

        <h2 className="h2">Grades</h2>
        <p>
          Each incident scores <strong>weight × scope × minutes</strong>, from start until the provider says it&apos;s monitoring a fix or resolved. Once it&apos;s resolved, Claude reads the whole thread, and if an earlier update says service was back to normal, minutes stop there. Minutes stop counting after 3 days for Sev 1, 1 day for the rest.
          Grades total the last 90 days, the same window for everyone.
        </p>
        <div className="tbl">
          <table>
            <tbody>
              <tr><th>Scope</th><th>Who was hit</th><th>×</th></tr>
              {SCOPE_ORDER.map((sc) => (
                <tr key={sc}>
                  <td><strong>{sc[0].toUpperCase() + sc.slice(1)}</strong></td>
                  <td>{SCOPE_BLURB[sc]}</td>
                  <td className="mono">{SCOPE_WEIGHT[sc]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          A hundred-location network that reports every local blip shouldn&apos;t score like one that went down everywhere. Security penalties
          aren&apos;t scaled.
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
          manage, including dashboard, auth and billing outages. Papercuts count toward the overall grade only. <strong>Admitted uptime</strong> counts only widespread Sev 1 time the provider posted
          itself, so it&apos;s a best case.
        </p>
        <p>
          Some feeds only list open incidents or the last few dozen, so history starts when we started polling. Under 14 days of data gets no grade
          and sits at the bottom. Under 90 days shows how many days the grade covers. Incidents left open for months paint the strips for a week, then stop.
        </p>

        <h2 className="h2" id="cost">Cost and bang for buck</h2>
        <p>
          Status pages don&apos;t publish prices, so cost is the one number here we curate by hand. For each category we price one reference workload
          against every provider&apos;s own public pricing page:
        </p>
        <ul>
          {CATEGORIES.filter((c) => isPriced(c.slug)).map((c) => (
            <li key={c.slug}>
              <strong>{c.name}: {WORKLOADS[c.slug]?.title}.</strong> {WORKLOADS[c.slug]?.summary}
            </li>
          ))}
        </ul>
        <p>
          Every provider page shows the line-by-line working, the source link and the date we last checked it. Usage-billed totals are marked as
          estimates with the assumption spelled out. A price older than {STALE_AFTER_DAYS} days is flagged as possibly out of date.
        </p>
        <p>
          We don&apos;t blend price and reliability into one score, because any weighting would be our opinion dressed up as data. Instead, a provider
          is <strong>best value</strong> when no other provider in its category costs the same or less with the same or better 90-day grade. Everyone
          else gets told who beats them. AI APIs have no cost on purpose: models differ too much in capability for price alone to be fair.
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
