import Link from "next/link";
import { choicesFor, filterQuery, toggleNeed, withQuery, type NeedFilter } from "@/lib/needs";
import { RegionSelect } from "./RegionSelect";

/** What you need and where: chips that narrow the board as soon as they're tapped. */
export function NeedBar({ category, filter, path, keep = "" }: { category: string; filter: NeedFilter; path: string; keep?: string }) {
  const { needs, regions } = choicesFor(category);
  if (!needs.length && !regions.length) return null;
  const href = (f: NeedFilter) => withQuery(path, keep, filterQuery(f));
  return (
    <div className="row need-bar" style={{ ["--gap" as string]: "6px" }}>
      <div role="group" aria-label="What you use" className="chips">
        {needs.map((n) => (
          <Link
            key={n.key}
            href={href(toggleNeed(filter, n.key))}
            scroll={false}
            className="chip small"
            aria-pressed={filter.needs.some((x) => x.key === n.key)}
            data-umami-event="need-filter"
            data-umami-event-need={n.key}
          >
            {n.label}
          </Link>
        ))}
      </div>
      {regions.length ? (
        <RegionSelect
          value={filter.region?.key ?? ""}
          options={[{ key: "", label: "Any region", href: href({ ...filter, region: null }) }, ...regions.map((r) => ({ key: r.key, label: r.label, href: href({ ...filter, region: r }) }))]}
          path={path}
          hidden={Object.fromEntries(new URLSearchParams([keep, filterQuery({ ...filter, region: null })].filter(Boolean).join("&")))}
        />
      ) : null}
    </div>
  );
}
