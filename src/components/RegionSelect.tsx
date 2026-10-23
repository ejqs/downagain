"use client";
import { useRouter } from "next/navigation";

type Option = { key: string; label: string; href: string };

/** Narrows the board to one region as soon as it changes. Falls back to a plain GET form without JS. */
export function RegionSelect({ value, options, path, hidden }: { value: string; options: Option[]; path: string; hidden: Record<string, string> }) {
  const router = useRouter();
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const o = options.find((x) => x.key === e.currentTarget.value);
    if (o) router.replace(o.href, { scroll: false });
  };
  return (
    <form action={path} method="get" className="prov-select">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <select name="region" aria-label="Region" value={value} onChange={onChange}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="btn">Go</button>
      </noscript>
    </form>
  );
}
