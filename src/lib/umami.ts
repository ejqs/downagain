const host = (process.env.UMAMI_HOST ?? "https://cloud.umami.is").replace(/\/$/, "");

/**
 * Proxies a request to Umami Cloud with a clean set of headers. A plain next.config
 * rewrite forwards everything, including Cloudflare's cdn-loop and cf-* headers from
 * our own zone, and Umami's Cloudflare answers that with a 403.
 */
export async function toUmami(path: string, req: Request, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers();
  for (const name of ["user-agent", "accept-language", "content-type"]) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }
  // Umami geolocates by IP; pass the visitor's, not ours.
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) headers.set("x-forwarded-for", ip);
  const res = await fetch(`${host}${path}`, { ...init, headers, cache: "no-store" });
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "text/plain" },
  });
}
