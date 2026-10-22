// Fill a LOCAL database with made-up incidents so the pages have something to show.
// Refuses to run against anything but localhost. Rows are marked origin "sample".
//   bun run dev:sample           add sample data
//   bun run dev:sample --clear   remove sample data
import { eq, inArray } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { categories, incidentUpdates, incidents, providerStatus, providers } from "@/db/schema";
import { seed } from "@/lib/seed";
import { classify } from "@/lib/severity";

const url = new URL(process.env.DATABASE_URL ?? "postgres://localhost");
if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
  console.error(`Refusing to write sample data to ${url.hostname}. This script is for local development only.`);
  process.exit(1);
}

const database = db();
const clear = process.argv.includes("--clear");
const samples = await database.select({ id: incidents.id }).from(incidents).where(eq(incidents.origin, "sample"));
if (samples.length) {
  await database.delete(incidentUpdates).where(inArray(incidentUpdates.incidentId, samples.map((s) => s.id)));
  await database.delete(incidents).where(eq(incidents.origin, "sample"));
}
if (clear) {
  console.log(`Removed ${samples.length} sample incidents`);
  await closeDb();
  process.exit(0);
}

await seed(database);
const rows = await database.select({ p: providers, cat: categories.slug }).from(providers).innerJoin(categories, eq(categories.id, providers.categoryId));

let seedN = 7;
const rand = () => ((seedN = (seedN * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

const COMPONENTS: Record<string, string[]> = {
  hosting: ["Edge Network", "Builds", "Deployments", "Dashboard", "API", "Postgres", "Serverless Functions", "Logs", "Billing", "DNS"],
  ai: ["Chat Completions", "Messages API", "Embeddings", "Fine-tuning", "Console", "Batch", "Realtime", "Login"],
};
const TITLES: Record<string, string[]> = {
  "Edge Network": ["Elevated 5xx on edge requests", "Increased latency in us-east"],
  Builds: ["Builds slow to start", "Builds failing for some projects"],
  Deployments: ["New deployments stuck on initializing", "Deploys delayed"],
  Dashboard: ["Dashboard not loading for some users", "Analytics charts delayed"],
  API: ["API returning errors", "Elevated API error rates"],
  Postgres: ["Database connectivity issues", "Degraded database performance"],
  "Serverless Functions": ["Function invocations timing out"],
  Logs: ["Log streaming delayed"],
  Billing: ["Invoices not generating"],
  DNS: ["DNS resolution failures for some domains"],
  "Chat Completions": ["Increased error rates on chat completions", "Elevated latency"],
  "Messages API": ["Elevated errors on the Messages API", "Overloaded errors"],
  Embeddings: ["Embeddings requests failing"],
  "Fine-tuning": ["Fine-tuning jobs stuck in queue"],
  Console: ["Console unavailable"],
  Batch: ["Batch jobs delayed"],
  Realtime: ["Realtime sessions dropping"],
  Login: ["Login failures"],
};

const now = Date.now();
let total = 0;
for (const { p, cat } of rows) {
  const comps = COMPONENTS[cat] ?? COMPONENTS.hosting;
  const rate = 0.05 + rand() * 0.25; // incidents per day
  const historyDays = 200 + Math.floor(rand() * 500);
  for (let d = historyDays; d > 0; d--) {
    if (rand() > rate) continue;
    const comp = pick(comps);
    const impact = pick(["minor", "minor", "major", "critical", "none"] as const);
    const start = now - d * 86_400_000 + Math.floor(rand() * 86_400_000);
    const minutes = 5 + Math.floor(rand() ** 2 * 300);
    const end = start + minutes * 60_000;
    if (end > now) continue;
    const title = pick(TITLES[comp] ?? ["Service disruption"]);
    const c = classify({ title, impact, components: [comp], worstComponentStatus: null, categorySlug: cat });
    const [row] = await database
      .insert(incidents)
      .values({
        providerId: p.id,
        externalId: `sample-${p.slug}-${d}`,
        title,
        impact,
        status: "resolved",
        startedAt: new Date(start),
        monitoringAt: new Date(start + minutes * 0.7 * 60_000),
        resolvedAt: new Date(end),
        url: p.statusPageUrl,
        components: [comp],
        postmortem: rand() < 0.2,
        origin: "sample",
        tier: c.tier,
        areaTiers: c.areaTiers,
        surfaces: c.surfaces,
        security: false,
        lowConfidence: c.lowConfidence,
        reason: c.reason,
        classifierVersion: c.classifierVersion,
      })
      .returning({ id: incidents.id });
    await database.insert(incidentUpdates).values([
      { incidentId: row.id, externalId: "1", status: "investigating", body: "We are investigating reports of this issue.", postedAt: new Date(start) },
      { incidentId: row.id, externalId: "2", status: "monitoring", body: "A fix has been deployed and we are monitoring.", postedAt: new Date(start + minutes * 0.7 * 60_000) },
      { incidentId: row.id, externalId: "3", status: "resolved", body: "This incident has been resolved.", postedAt: new Date(end) },
    ]);
    total++;
  }
  await database
    .update(providers)
    .set({ historyFrom: new Date(now - historyDays * 86_400_000) })
    .where(eq(providers.id, p.id));
  await database
    .insert(providerStatus)
    .values({ providerId: p.id, status: "operational", since: new Date(now - 3_600_000), lastCheckedAt: new Date(now), lastOkAt: new Date(now), components: [] })
    .onConflictDoNothing();
}

// Two things going wrong right now, so the banner shows.
for (const [slug, comp, title, impact, mins] of [
  ["vercel", "Edge Network", "Elevated 5xx on edge requests in iad1", "major", 42],
  ["openai", "Chat Completions", "Increased error rates on chat completions", "minor", 48],
] as const) {
  const r = rows.find((x) => x.p.slug === slug);
  if (!r) continue;
  const c = classify({ title, impact, components: [comp], worstComponentStatus: null, categorySlug: r.cat });
  await database.insert(incidents).values({
    providerId: r.p.id, externalId: `sample-open-${slug}`, title, impact, status: "investigating", startedAt: new Date(now - mins * 60_000),
    url: r.p.statusPageUrl, components: [comp], origin: "sample", tier: c.tier, areaTiers: c.areaTiers, surfaces: c.surfaces, reason: c.reason, classifierVersion: c.classifierVersion,
  });
  total++;
}
console.log(`Inserted ${total} sample incidents. Remove them with: bun run dev:sample --clear`);
await closeDb();
