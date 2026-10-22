import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { Getter, GetOptions } from "@/lib/types";
import { SITE } from "@/lib/site";

export const USER_AGENT = `downagain.dev/1.0 (+${SITE}/about)`;
const TIMEOUT_MS = 8_000;
// The biggest real feed (Statuspage incidents.json) is a few hundred KB.
const MAX_BODY_BYTES = 10 * 1024 * 1024;
// Cloud history files (Google's incidents.json, AWS's historyevents) run to several MB.
const LARGE_TIMEOUT_MS = 30_000;
const LARGE_MAX_BODY_BYTES = 50 * 1024 * 1024;

/** File name a fixture for `url` is stored under, e.g. www.vercel-status.com__api_v2_summary.json */
export function fixtureName(url: string, as: GetOptions["as"] = "json"): string {
  const u = new URL(url);
  const p = u.pathname.replace(/^\/|\/$/g, "").replace(/\//g, "_");
  const ext = as === "text" ? ".xml" : ".json";
  return `${u.host}${p ? "__" + p : ""}`.replace(/\.(json|xml|rss)$/, "") + ext;
}

/**
 * Bytes to text. AWS serves the same data gzipped, UTF-16 with a BOM, or UTF-8
 * depending on the endpoint, so check rather than trust the headers.
 */
export function decodeBody(buf: Uint8Array, max = LARGE_MAX_BODY_BYTES): string {
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf, { maxOutputLength: max });
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  return new TextDecoder("utf-8").decode(buf);
}

function parse(text: string, as: GetOptions["as"]): unknown {
  return as === "text" ? text : JSON.parse(text);
}

/**
 * A polite GET: identifies us, sends If-None-Match, times out, never retries in a loop.
 * `etags` is read and updated in place so the poller can persist it.
 * With STATUS_FIXTURES_DIR set, reads local files instead of the network (dev and tests).
 */
export function makeGetter(etags: Record<string, string>): Getter {
  const fixtures = process.env.STATUS_FIXTURES_DIR;
  if (fixtures) {
    return async (url, opts = {}) => {
      const buf = await readFile(path.join(fixtures, fixtureName(url, opts.as)));
      return { notModified: false, body: parse(decodeBody(buf), opts.as) };
    };
  }

  return async (url, opts = {}) => {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: opts.as === "text" ? "application/rss+xml, application/xml, text/xml" : "application/json",
    };
    if (etags[url] && !opts.fresh) headers["If-None-Match"] = etags[url];
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(opts.large ? LARGE_TIMEOUT_MS : TIMEOUT_MS), cache: "no-store" });
    // Status pages are https. A redirect anywhere else (say, to a private
    // http://*.railway.internal address) is refused rather than read.
    if (res.url && new URL(res.url).protocol !== "https:") throw new Error(`${new URL(url).host} redirected off https`);
    if (res.status === 304) return { notModified: true };
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    const etag = res.headers.get("etag");
    if (etag && !opts.fresh) etags[url] = etag;
    else delete etags[url];
    const max = opts.large ? LARGE_MAX_BODY_BYTES : MAX_BODY_BYTES;
    return { notModified: false, body: parse(decodeBody(await readCapped(res, max), max), opts.as) };
  };
}

/** Body as bytes, failing once it passes `max` bytes so a huge or endless feed can't exhaust memory. */
export async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > max) throw new Error(`${new URL(res.url || "http://unknown").host} sent ${declared} bytes`);
  if (!res.body) return new Uint8Array();
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
  return Buffer.concat(chunks);
}
