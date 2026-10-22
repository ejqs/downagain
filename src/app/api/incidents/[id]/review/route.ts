import { readReview } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * The full audit record behind an AI-graded incident: the model and prompt
 * version, what the rules said, exactly what Claude read and exactly what it
 * answered. Linked from "Why this grade" on provider pages.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return Response.json({ error: "not found" }, { status: 404 });
  let r;
  try {
    r = await readReview(n);
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  if (!r) return Response.json({ error: "no AI review for this incident" }, { status: 404 });
  const v = r.review;
  return Response.json(
    {
      incident: { id: n, provider: r.provider, title: r.title, gradedBy: r.gradedBy },
      model: v.model,
      promptVersion: v.promptVersion,
      reviewedAt: v.createdAt.toISOString(),
      rules: { tier: v.rulesTier, reason: v.rulesReason },
      claude: { tier: v.tier, verdict: v.verdict, error: v.error },
      input: v.input,
      rawOutput: v.rawOutput,
      usage: { inputTokens: v.inputTokens, outputTokens: v.outputTokens, costUsd: v.costMicros / 1_000_000 },
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
