import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Getter } from "@/lib/types";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://downagain.dev";
export const USER_AGENT = `downagain.dev/1.0 (+${SITE}/about)`;
const TIMEOUT_MS = 8_000;

/** File name a fixture for `url` is stored under, e.g. www.vercel-status.com__api_v2_summary.json */
export function fixtureName(url: string): string {
  const u = new URL(url);
  const p = u.pathname.replace(/^\/|\/$/g, "").replace(/\//g, "_");
  return `${u.host}${p ? "__" + p : ""}`.replace(/\.json$/, "") + ".json";
}

/**
 * A polite GET: identifies us, sends If-None-Match, times out, never retries in a loop.
 * `etags` is read and updated in place so the poller can persist it.
 * With STATUS_FIXTURES_DIR set, reads local files instead of the network (dev and tests).
 */
export function makeGetter(etags: Record<string, string>): Getter {
  const fixtures = process.env.STATUS_FIXTURES_DIR;
  if (fixtures) {
    return async (url) => {
      const body = JSON.parse(await readFile(path.join(fixtures, fixtureName(url)), "utf8"));
      return { notModified: false, body };
    };
  }

  return async (url) => {
    const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/json" };
    if (etags[url]) headers["If-None-Match"] = etags[url];
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (res.status === 304) return { notModified: true };
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    const etag = res.headers.get("etag");
    if (etag) etags[url] = etag;
    else delete etags[url];
    return { notModified: false, body: await res.json() };
  };
}
