import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Getter } from "@/lib/types";
import { SITE } from "@/lib/site";

export const USER_AGENT = `downagain.dev/1.0 (+${SITE}/about)`;
const TIMEOUT_MS = 8_000;
// The biggest real feed (Statuspage incidents.json) is a few hundred KB.
const MAX_BODY_BYTES = 10 * 1024 * 1024;

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
    // Status pages are https. A redirect anywhere else (say, to a private
    // http://*.railway.internal address) is refused rather than read.
    if (res.url && new URL(res.url).protocol !== "https:") throw new Error(`${new URL(url).host} redirected off https`);
    if (res.status === 304) return { notModified: true };
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    const etag = res.headers.get("etag");
    if (etag) etags[url] = etag;
    else delete etags[url];
    return { notModified: false, body: JSON.parse(await readCapped(res, MAX_BODY_BYTES)) };
  };
}

/** Body as text, failing once it passes `max` bytes so a huge or endless feed can't exhaust memory. */
export async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > max) throw new Error(`${new URL(res.url || "http://unknown").host} sent ${declared} bytes`);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error(`${new URL(res.url || "http://unknown").host} sent over ${max} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
