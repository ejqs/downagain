import Link from "next/link";
import type { Snapshot } from "@/lib/data";
import { valueBoard, type ValueRow } from "@/lib/views";
import { WORKLOADS, fmtUsd, isStale } from "@/lib/pricing";
import { GradeTile, Hint } from "./ui";

export function beatText(r: ValueRow, by: ValueRow): string {
  const cost = by.usd === r.usd ? "same price" : "cheaper";
  const grade = by.score.grade === r.score.grade ? "same grade" : "better grade";
  return `${by.provider.name}: ${cost}, ${grade}`;
}

export const priceText = (v: ValueRow | undefined) => (v?.usd != null ? `${v.price?.estimate ? "~" : ""}${fmtUsd(v.usd)}` : "–");

/** "Bang for buck": the category by reference-workload price, with the value frontier marked. */
export function ValueBoard({ snap, category }: { snap: Snapshot; category: string }) {
  const rows = valueBoard(snap, category);
  const work = WORKLOADS[category];
  if (!work || rows.every((r) => r.usd == null)) return null;
  return (
    <section id="value" aria-label="Bang for buck" className="section stack" style={{ ["--gap" as string]: "14px" }}>
      <div className="stack" style={{ ["--gap" as string]: "6px" }}>
        <h2 className="h2">Bang for buck</h2>
        <div className="body">
          <Hint label={`${work.title}, per month`}>{work.summary}</Hint>
        </div>
      </div>
      <div className="box">
        {rows.map((r) => (
          <div key={r.provider.slug} className="list-row" style={{ ["--gap" as string]: "8px 20px" }}>
            <div className="board-name" style={{ flex: "1 1 220px" }}>
              <GradeTile grade={r.score.grade} label={`Overall grade ${r.score.grade}`} />
              <div className="stack" style={{ ["--gap" as string]: "2px", minWidth: 0 }}>
                <div className="row" style={{ ["--gap" as string]: "8px" }}>
                  <Link href={`/p/${r.provider.slug}#cost`}>{r.provider.name}</Link>
                  {r.bestValue ? <span className="pill value">BEST VALUE</span> : null}
                  {r.price && isStale(r.price, snap.generatedAt) ? <span className="pill unknown">OLD PRICE</span> : null}
                </div>
                <span className="muted" style={{ fontSize: 14 }}>{r.price?.plan ?? "–"}</span>
              </div>
            </div>
            <div className="metric" style={{ flex: "0 0 96px" }}>
              <b>{priceText(r)}</b>
              <span>{r.usd == null ? "NO PRICE" : r.price?.estimate ? "ESTIMATE" : "LIST PRICE"}</span>
            </div>
            <span className="muted" style={{ flex: "1 1 200px", fontSize: 14 }}>
              {r.beatenBy ? beatText(r, rows.find((x) => x.provider.id === r.beatenBy!.id)!) : r.usd == null ? r.price?.note : null}
            </span>
          </div>
        ))}
      </div>
      <p className="mono" style={{ fontSize: 12, color: "var(--body)" }}>
        BEST VALUE = nothing cheaper with an equal or better grade. <Link href="/about#cost">How we price</Link>
      </p>
    </section>
  );
}
