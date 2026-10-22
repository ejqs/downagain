export const dynamic = "force-dynamic";

/** Railway healthcheck. Doesn't touch the database, so a DB blip doesn't restart the web service. */
export function GET() {
  return Response.json({ ok: true });
}
