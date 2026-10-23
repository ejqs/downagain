"use client";
import { useEffect, useRef, useState } from "react";
import { Hint } from "@/components/ui";
import { GLOSSARY } from "@/lib/glossary";

type Counts = { lastHour: number; hours: number[] };
type Phase = "idle" | "checking" | "sending" | "done" | "error";

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SLOT_MS = 30 * 60_000;
let loading: Promise<Turnstile> | null = null;

/** Loads Turnstile on the first tap only, so pages nobody reports from never fetch it. */
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => {
      loading = null;
      reject(new Error("turnstile blocked"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

const key = (slug: string) => `reported:${slug}`;
function reportedRecently(slug: string) {
  try {
    return Date.now() - Number(localStorage.getItem(key(slug)) ?? 0) < SLOT_MS;
  } catch {
    return false;
  }
}

const MESSAGES: Record<number, string> = { 403: "Check failed. Try again.", 429: "Too many reports from you this hour." };

/** "Down for me": counts fetched after load so the page stays cached, and one tap to add yours. */
export function UserReports({ slug, siteKey }: { slug: string; siteKey: string }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    if (reportedRecently(slug)) setPhase("done");
    const ctrl = new AbortController();
    fetch(`/api/reports/${slug}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Counts | null) => c && setCounts(c))
      .catch(() => {});
    return () => {
      ctrl.abort();
      if (widget.current) window.turnstile?.remove(widget.current);
    };
  }, [slug]);

  const send = async (token: string) => {
    setPhase("sending");
    try {
      const res = await fetch(`/api/reports/${slug}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const body = (await res.json().catch(() => ({}))) as Partial<Counts>;
      if (!res.ok) throw new Error(MESSAGES[res.status] ?? "Couldn't send. Try again.");
      if (body.hours) setCounts({ lastHour: body.lastHour ?? 0, hours: body.hours });
      try {
        localStorage.setItem(key(slug), String(Date.now()));
      } catch {}
      setPhase("done");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    } finally {
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    }
  };

  const start = async () => {
    setError("");
    setPhase("checking");
    try {
      const ts = await loadTurnstile();
      if (!box.current) return;
      if (widget.current) ts.remove(widget.current);
      widget.current = ts.render(box.current, {
        sitekey: siteKey,
        action: "report",
        cData: slug,
        appearance: "interaction-only",
        callback: (token: string) => void send(token),
        "error-callback": () => {
          setError("Check failed. Try again.");
          setPhase("error");
        },
        "expired-callback": () => setPhase("idle"),
      });
    } catch {
      setError("Couldn't load the check. An ad blocker may be stopping it.");
      setPhase("error");
    }
  };

  const max = Math.max(1, ...(counts?.hours ?? [0]));
  const total = counts?.hours.reduce((a, b) => a + b, 0) ?? 0;
  const busy = phase === "checking" || phase === "sending";

  return (
    <div className="reports" aria-live="polite">
      <div className="stack" style={{ ["--gap" as string]: "4px", minWidth: 0 }}>
        <span className="label">
          <Hint label="User reports">{GLOSSARY.userReports}</Hint>
        </span>
        <div className="row" style={{ ["--gap" as string]: "10px", flexWrap: "nowrap" }}>
          <span className="mono" style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" }}>
            {counts == null ? "…" : total ? `${counts.lastHour} in the last hour` : "None in 24h"}
          </span>
          {counts && total ? (
            <span className="spark" role="img" aria-label={`${total} in 24 hours`}>
              {counts.hours.map((n, i) => (
                <span key={i} style={{ height: `${Math.max(8, (n / max) * 100)}%`, background: n ? "var(--down)" : "var(--rule)" }} />
              ))}
            </span>
          ) : null}
        </div>
      </div>
      <div className="stack" style={{ ["--gap" as string]: "6px", alignItems: "flex-start" }}>
        <button type="button" className="btn" onClick={start} disabled={busy || phase === "done"} data-umami-event="user-report">
          {phase === "done" ? "Reported" : busy ? "Checking…" : "Down for me"}
        </button>
        <div ref={box} />
        {phase === "error" ? <span className="muted" style={{ fontSize: 13 }}>{error}</span> : null}
      </div>
    </div>
  );
}
