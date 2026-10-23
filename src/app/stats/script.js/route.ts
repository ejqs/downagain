import { toUmami } from "@/lib/umami";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const res = await toUmami("/script.js", req);
  if (res.ok) res.headers.set("cache-control", "public, max-age=3600");
  return res;
}
