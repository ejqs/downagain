// "Down for me" reports. Visitors tap a button, pass Cloudflare Turnstile, and we
// count them. These never touch incidents, tiers or grades: they are what visitors
// say, not what the provider admitted, and the page labels them that way.
import { createHmac } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { providers, userReports } from "@/db/schema";
import { SITE } from "@/lib/site";

const HOUR = 3_600_000;
export const SLOT_MS = 30 * 60_000; // one report per visitor and provider per 30 minutes
export const MAX_PER_HOUR = 10; // across providers; a big outage takes out a few at once
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const ACTION = "report";

export interface ReportCounts {
  lastHour: number;
  /** 24 hourly counts, oldest first; the last one is the past hour. */
  hours: number[];
}

// The downagain.dev widget's site key. Public by design (it ships in the page);
// TURNSTILE_SITE_KEY overrides it, e.g. with Cloudflare's test keys locally.
export const SITE_KEY = "0x4AAAAAAFj8gDfM99pCcbRY";

/** Needs the secret, or the feature stays hidden and the POST refuses. */
export function turnstileKeys() {
  const siteKey = process.env.TURNSTILE_SITE_KEY || SITE_KEY;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  return siteKey && secret ? { siteKey, secret } : null;
}

/**
 * The visitor's IP. Cloudflare sets cf-connecting-ip; Railway's edge appends to
 * x-forwarded-for. A forged header only dodges the per-visitor limits, never the
 * Turnstile check every report needs.
 */
export function clientIp(h: Headers): string | null {
  const ip = h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0];
  return ip?.trim() || null;
}

/** A per-day pseudonym: the same visitor matches within a UTC day, and the IP is never stored. */
export function reporterId(ip: string, now: number, secret: string) {
  const day = new Date(now).toISOString().slice(0, 10);
  return createHmac("sha256", secret).update(`${day}|${ip}`).digest("base64url").slice(0, 22);
}

type Siteverify = { success: boolean; action?: string; cdata?: string; hostname?: string; "error-codes"?: string[] };

// Cloudflare's dummy secrets (1x…, 2x…, 3x… followed by zeros) answer without action, cdata or a real hostname.
const isTestSecret = (secret: string) => /^[123]x0{20,}AA$/.test(secret);

/**
 * Asks Cloudflare whether the token is real, unused (tokens are single-use and
 * expire after 5 minutes) and minted on our domain for this provider's button.
 */
export async function verifyTurnstile(token: string, slug: string, ip: string | null, secret: string, fetchImpl: typeof fetch = fetch, host = new URL(SITE).hostname) {
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetchImpl(SITEVERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const r = (await res.json()) as Siteverify;
    if (r.success !== true) return false;
    if (isTestSecret(secret)) return true;
    return r.action === ACTION && r.cdata === slug && r.hostname === host;
  } catch {
    return false;
  }
}

export async function providerIdFor(database: DB, slug: string) {
  const [p] = await database
    .select({ id: providers.id })
    .from(providers)
    .where(and(eq(providers.slug, slug), eq(providers.enabled, true)));
  return p?.id ?? null;
}

export async function countReports(database: DB, providerId: number, now: number): Promise<ReportCounts> {
  const since = new Date(now - 24 * HOUR);
  const age = sql<number>`floor(extract(epoch from (${new Date(now).toISOString()}::timestamptz - ${userReports.createdAt})) / 3600)::int`;
  const rows = await database
    .select({ age, n: sql<number>`count(*)::int` })
    .from(userReports)
    .where(and(eq(userReports.providerId, providerId), gte(userReports.createdAt, since)))
    .groupBy(sql`1`); // by position: the two copies of `age` bind separate params
  const hours = Array<number>(24).fill(0);
  for (const r of rows) {
    const a = Number(r.age);
    if (a >= 0 && a < 24) hours[23 - a] += Number(r.n);
  }
  return { lastHour: hours[23], hours };
}

export type Outcome = "added" | "duplicate" | "limited";

/** Stores one report unless this visitor already reported this provider in the slot, or reported too much this hour. */
export async function addReport(database: DB, r: { providerId: number; reporter: string; country: string | null; now: number }): Promise<Outcome> {
  const [{ n }] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(userReports)
    .where(and(eq(userReports.reporter, r.reporter), gte(userReports.createdAt, new Date(r.now - HOUR))));
  if (Number(n) >= MAX_PER_HOUR) return "limited";
  const inserted = await database
    .insert(userReports)
    .values({
      providerId: r.providerId,
      reporter: r.reporter,
      slot: Math.floor(r.now / SLOT_MS),
      country: r.country && /^[A-Z]{2}$/.test(r.country) ? r.country : null,
      createdAt: new Date(r.now),
    })
    .onConflictDoNothing()
    .returning({ id: userReports.id });
  return inserted.length ? "added" : "duplicate";
}

// Counts are read on every provider page view, so keep them for a few seconds in
// memory (one web replica) instead of asking Postgres each time.
const cache = new Map<number, { at: number; counts: ReportCounts }>();
const CACHE_MS = 20_000;

export async function cachedCounts(database: DB, providerId: number, now = Date.now()) {
  const hit = cache.get(providerId);
  if (hit && now - hit.at < CACHE_MS) return hit.counts;
  const counts = await countReports(database, providerId, now);
  cache.set(providerId, { at: now, counts });
  return counts;
}

export function forgetCounts(providerId?: number) {
  if (providerId == null) cache.clear();
  else cache.delete(providerId);
}
