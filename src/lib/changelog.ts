// Every change to how grades are worked out, newest first. Rendered at
// /about/changelog. Add an entry in the same PR as any change to severity.ts
// rules, Claude's prompt, points, area grades or admitted uptime. Dates are UTC
// merge dates; copy follows docs/voice.md.

export type ChangeRef = { pr: number } | { commit: string };

export interface Change {
  date: string; // YYYY-MM-DD
  title: string;
  refs: ChangeRef[];
  items: string[];
}

export const CHANGELOG: Change[] = [
  {
    date: "2026-10-24",
    title: "Local trouble isn't a blackout",
    refs: [{ pr: 27 }],
    items: [
      "Incidents short of global (one region, carrier, plan or add-on) stop adding points after 6 hours. Global ones still run to 1 day, or 3 for Sev 1.",
      "Third-party carrier networks (Twilio's \"CARRIER NETWORK\" components: one operator's SMS or calls in one country) count as local, x0.1.",
      "Admitted uptime unchanged.",
    ],
  },
  {
    date: "2026-10-24",
    title: "Overlapping incidents count once",
    refs: [{ pr: 23 }],
    items: [
      "Points, overall and for PROD and SHIP, count each minute once, at the worst incident running then. Was the sum, so an outage posted twice cost double.",
      "Per provider: a stack hit by two providers at once pays for both. The security penalty is unchanged.",
    ],
  },
  {
    date: "2026-10-24",
    title: "Incident timelines",
    refs: [{ pr: 22 }],
    items: [
      "Claude links a new incident to the earlier one it continues, from the provider's titles over the previous 14 days. Security follow-ups within a week of a compromise and near-identical reposts join the same timeline.",
      "Display only. Grades unchanged.",
    ],
  },
  {
    date: "2026-10-24",
    title: "Exposed credentials are security, not data loss",
    refs: [{ pr: 21 }],
    items: [
      "Railway's Oct 21 incident (rotate env-var credentials) had read as data loss and counted as Sev 1 PROD for two days. Credential exposure now only adds the compromise penalty.",
    ],
  },
  {
    date: "2026-10-24",
    title: "One breach, one security penalty",
    refs: [{ pr: 20 }],
    items: [
      "Compromise incidents starting within 7 days of an earlier one keep the SECURITY pill but add no further penalty points.",
    ],
  },
  {
    date: "2026-10-24",
    title: "Claude held to the rubric",
    refs: [{ pr: 17 }],
    items: [
      "Add-on products are single scope. Rolling restarts with some hosts down are subset. Paused sign-ups and support sites are papercuts.",
      "Late SMS or calls are Sev 2. Serving and data incidents are never Sev 3, and Sev 1 only when global or unclear.",
      "\"We have observed a recovery\" counts as recovered.",
    ],
  },
  {
    date: "2026-10-24",
    title: "Admitted uptime counts customer-minutes",
    refs: [{ pr: 16 }],
    items: [
      "Was widespread Sev 1 only, so 36 of 39 providers read 100.00%. Now minutes × depth (down 1, degraded 0.5) × scope weight, worst incident at each moment, at most a week per incident.",
      "Provider pages add Fully down: widespread Sev 1 time, unweighted.",
    ],
  },
  {
    date: "2026-10-24",
    title: "Railway-style compromises caught",
    refs: [{ pr: 15 }],
    items: ["Revoked tokens, rotated bucket credentials and a named attacker now count as a compromise. Railway's Oct 21 breach had missed the penalty."],
  },
  {
    date: "2026-10-24",
    title: "Security by impact",
    refs: [{ pr: 14 }],
    items: [
      "A security flag no longer raises the tier. Security incidents are graded on impact like any other.",
      "The 600-point penalty needs a real compromise: unauthorized access, exposed or leaked credentials, a breach. DDoS, patched vulnerabilities and \"not affected\" CVE notices score on impact alone.",
      "Papercuts no longer count toward SHIP. One-region cloud security incidents top out at Sev 2.",
    ],
  },
  {
    date: "2026-10-24",
    title: "Audit fixes",
    refs: [{ pr: 13 }],
    items: [
      "Days without a Sev 1 ignores a Sev 1 after its first week, as the heatmap does.",
      "Most Sev 1-2 time, 7d counts overlapping incidents once.",
      "Trends show – for months before our data.",
    ],
  },
  {
    date: "2026-10-23",
    title: "Scope from listed cities",
    refs: [{ commit: "2cdef27" }],
    items: [
      "Rules read scope from the incident: one city is local, up to 10 regional, \"some users\" a subset. Claude's \"unclear\" no longer erases a scope the rules found.",
    ],
  },
  {
    date: "2026-10-23",
    title: "Filtered views grade only what you use",
    refs: [{ pr: 11 }],
    items: ["With needs picked, the overall grade adds up only the areas they touch: SHIP for Deploys, PROD for the rest."],
  },
  {
    date: "2026-10-23",
    title: "Penalty stops at recovery",
    refs: [{ commit: "f878888" }],
    items: [
      "Once resolved, minutes stop at the first update saying service was back to normal, if earlier than monitoring or resolve.",
      "Open incidents in monitoring show MONITORING, not DOWN.",
    ],
  },
  {
    date: "2026-10-23",
    title: "Longest counts outages only",
    refs: [{ pr: 6 }, { commit: "e6dadda" }],
    items: ["Sev 1-2 only, and only incidents that began in the window."],
  },
  {
    date: "2026-10-23",
    title: "Grade only what the data covers",
    refs: [{ pr: 3 }],
    items: [
      "Under 14 days of data gets no grade. Under 90 days shows the days covered.",
      "Admitted uptime counts only widespread Sev 1s, not one-region ones.",
      "Duplicate components listed twice by a status page count once. Incidents naming only a provider's own apps are papercuts.",
    ],
  },
  {
    date: "2026-10-22",
    title: "Single scope",
    refs: [{ commit: "e54c6c6" }],
    items: [
      "One model, endpoint or add-on among many is single scope, × 0.1.",
      "Worst lists on provider pages rank by points, not tier.",
    ],
  },
  {
    date: "2026-10-22",
    title: "Penalty capped at a day below Sev 1",
    refs: [{ commit: "5e9ca50" }],
    items: ["Sev 1 counts up to 3 days, Sev 2-4 up to 1. Was 3 days for every tier."],
  },
  {
    date: "2026-10-22",
    title: "Heaviest incidents read first",
    refs: [{ commit: "26a31aa" }],
    items: ["Claude reads pending incidents in order of the points they cost, so the ones that decide a grade get checked first."],
  },
  {
    date: "2026-10-22",
    title: "Database and cloud fixes",
    refs: [{ commit: "15c8403" }, { commit: "35ac4cd" }],
    items: [
      "Database management API, lifecycle and pause incidents are SHIP.",
      "An AWS event's own region sets its scope.",
    ],
  },
  {
    date: "2026-10-22",
    title: "Narrow features are still serving",
    refs: [{ commit: "40c1c58" }],
    items: ["Any product customers build on counts as serving. Narrow impact lowers the scope, not the tier."],
  },
  {
    date: "2026-10-22",
    title: "Points scale by blast radius",
    refs: [{ commit: "99cfc60" }],
    items: ["Points become weight × scope × minutes. Global and unclear × 1, regional and subset × 0.3, one location × 0.1. Security penalties aren't scaled."],
  },
  {
    date: "2026-10-22",
    title: "Abandoned incidents end",
    refs: [{ commit: "cd935e7" }],
    items: ["An open incident with no update for 7 days ends at its last update. One left open since August had made an F on its own."],
  },
  {
    date: "2026-10-22",
    title: "Why this grade",
    refs: [{ commit: "f8a42ed" }, { commit: "ec161c1" }],
    items: [
      "Every AI-graded incident shows the rules' call, Claude's call, the model, the date and the raw record.",
      "Long incidents get a short summary from Claude.",
    ],
  },
  {
    date: "2026-10-22",
    title: "Best value",
    refs: [{ commit: "0493311" }, { commit: "a9967cb" }],
    items: ["Best value when nobody in the category costs the same or less with the same or better grade. AI APIs unpriced."],
  },
  {
    date: "2026-10-22",
    title: "PROD and SHIP",
    refs: [{ commit: "d652b26" }],
    items: [
      "Two area grades replace Production, Shipping and Dashboard. PROD: users hit. SHIP: can't deploy, build or manage, including dashboard, auth and billing outages that block it.",
      "Papercuts count toward the overall grade only.",
    ],
  },
  {
    date: "2026-10-22",
    title: "Claude grades on top of the rules",
    refs: [{ commit: "6aa7edb" }],
    items: ["Claude reads each new or changed incident and refines the rules' tier, scope, security and data loss calls. The rules stay as fallback."],
  },
  {
    date: "2026-10-22",
    title: "First grades",
    refs: [{ pr: 1 }],
    items: [
      "Sev 1-4 from status-page components and levels. Points = weight × minutes over 90 days, capped at 3 days, A+ to F.",
      "Security incidents at least Sev 2, plus 600 points.",
      "Admitted uptime = time without a Sev 1.",
    ],
  },
];
