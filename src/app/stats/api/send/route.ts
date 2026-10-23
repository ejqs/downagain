import { toUmami } from "@/lib/umami";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return toUmami("/api/send", req, { method: "POST", body: await req.text() });
}
