"use client";
import { useRouter } from "next/navigation";

type Group = { name: string; provs: { slug: string; name: string }[] };

/** Narrows the incidents page to one provider as soon as it changes. Falls back to a plain GET form without JS. */
export function ProviderSelect({ value, groups, keep }: { value: string; groups: Group[]; keep: Record<string, string> }) {
  const router = useRouter();
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sp = new URLSearchParams(keep);
    if (e.currentTarget.value) sp.set("p", e.currentTarget.value);
    const str = sp.toString();
    router.replace(`/incidents${str ? `?${str}` : ""}`, { scroll: false });
  };
  return (
    <form action="/incidents" method="get" className="prov-select">
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <select name="p" aria-label="Provider" defaultValue={value} onChange={onChange}>
        <option value="">All providers</option>
        {groups.map((g) => (
          <optgroup key={g.name} label={g.name}>
            {g.provs.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <noscript>
        <button type="submit" className="btn">Go</button>
      </noscript>
    </form>
  );
}
