"use client";
import { useRouter } from "next/navigation";
import { pickParam, stackHref, togglePart, type StackPick } from "@/lib/stack";

type Group = { name: string; provs: { slug: string; name: string }[] };

/** Adds a provider to the stack as soon as one is chosen. Falls back to a plain GET form without JS. */
export function AddProvider({ groups, picks }: { groups: Group[]; picks: StackPick[] }) {
  const router = useRouter();
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const slug = e.currentTarget.value;
    if (slug) router.replace(stackHref([...picks, { slug, parts: [] }]), { scroll: false });
  };
  return (
    <form action="/stack" method="get" className="prov-select">
      {picks.map((p) => (
        <input key={p.slug} type="hidden" name="u" value={pickParam(p)} />
      ))}
      <select name="u" aria-label="Add a provider" value="" onChange={onChange}>
        <option value="">Add a provider</option>
        {groups.map((g) => (
          <optgroup key={g.name} label={g.name}>
            {g.provs.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <noscript>
        <button type="submit" className="btn">Add</button>
      </noscript>
    </form>
  );
}

/** Finds one of a provider's parts by name and adds it. */
export function AddPart({ slug, parts, picks }: { slug: string; parts: { key: string; name: string }[]; picks: StackPick[] }) {
  const router = useRouter();
  const byName = new Map(parts.map((p) => [p.name.toLowerCase(), p.key]));
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = byName.get(e.currentTarget.value.trim().toLowerCase());
    if (key) {
      e.currentTarget.value = "";
      router.replace(stackHref(togglePart(picks, slug, key)), { scroll: false });
    }
  };
  return (
    <span className="part-find">
      <input type="search" list={`parts-${slug}`} aria-label="Find a part" placeholder={`${parts.length} more`} onChange={onChange} autoComplete="off" />
      <datalist id={`parts-${slug}`}>
        {parts.map((p) => (
          <option key={p.key} value={p.name} />
        ))}
      </datalist>
    </span>
  );
}
