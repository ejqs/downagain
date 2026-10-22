"use client";
import { useRouter } from "next/navigation";

type Option = { cat: { slug: string; name: string }; provs: { slug: string; name: string }[] };

/** Provider selects that update the comparison as soon as one changes. Falls back to a plain GET form without JS. */
export function ComparePicker({ slugs, options }: { slugs: string[]; options: Option[] }) {
  const router = useRouter();
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const form = new FormData(e.currentTarget.form!);
    const picked = ["a", "b", "c"].map((k) => String(form.get(k) ?? "")).filter(Boolean);
    router.replace(`/compare?p=${[...new Set(picked)].join(",")}`, { scroll: false });
  };
  return (
    <form className="pickers" action="/compare" method="get">
      {[0, 1, 2].map((k) => (
        <label key={k} className="label">
          Provider {k + 1}
          <select name={["a", "b", "c"][k]} defaultValue={slugs[k] ?? ""} onChange={onChange}>
            {k === 2 ? <option value="">None</option> : null}
            {options.map(({ cat, provs }) => (
              <optgroup key={cat.slug} label={cat.name}>
                {provs.map((p) => (
                  <option key={p.slug} value={p.slug}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ))}
      <noscript>
        <button type="submit" className="btn dark">Compare</button>
      </noscript>
    </form>
  );
}
