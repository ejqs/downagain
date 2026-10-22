// Comparison URLs: /compare/netlify-vs-vercel. A page shows providers in the order
// picked; its canonical address sorts them, so each matchup is indexed once.
const SEP = "-vs-";

export const MAX_COMPARE = 3;

export const canonicalSlugs = (slugs: string[]) => [...new Set(slugs)].sort();

export const pairPath = (slugs: string[]) => `/compare/${[...new Set(slugs)].join(SEP)}`;

export const comparePath = (slugs: string[]) => pairPath(canonicalSlugs(slugs));

/** Where a compare link goes: the matchup page, or the picker if there's only one provider. */
export const compareHref = (slugs: string[]) => {
  const unique = [...new Set(slugs)];
  return unique.length >= 2 ? pairPath(unique) : `/compare?p=${unique.join(",")}`;
};

/** "netlify-vs-vercel" to ["netlify", "vercel"], in the order written. */
export const parsePair = (pair: string) => decodeURIComponent(pair).toLowerCase().split(SEP).filter(Boolean);

/** Every two-provider matchup inside each category, canonical order. */
export function matchups<P extends { slug: string; category: string }>(providers: P[]): [P, P][] {
  const out: [P, P][] = [];
  const sorted = [...providers].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) if (sorted[i].category === sorted[j].category) out.push([sorted[i], sorted[j]]);
  return out;
}
