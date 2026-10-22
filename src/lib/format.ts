export function fmtDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function fmtPct(fraction: number, digits = 2): string {
  const v = fraction * 100;
  // Never round a real outage up to a perfect 100%.
  if (fraction < 1 && v.toFixed(digits) === (100).toFixed(digits)) return `${(100 - 10 ** -digits).toFixed(digits)}%`;
  return `${v.toFixed(digits)}%`;
}

export function fmtAgo(ms: number, now = Date.now()): string {
  if (now - ms < 60_000) return "just now";
  return `${fmtDuration((now - ms) / 60_000)} ago`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

export const fmtDate = (ms: number) => dateFmt.format(ms);
export const fmtDay = (ms: number) => dayFmt.format(ms);
export const fmtTime = (ms: number) => `${timeFmt.format(ms)} UTC`;
export const fmtMonth = (ms: number) => monthFmt.format(ms);
export const fmtMonthShort = (ms: number) => monthShort.format(ms);

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `url` if it is an absolute http(s) link, else null. Feeds are untrusted; this keeps javascript: and friends out of hrefs. */
export function httpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}
