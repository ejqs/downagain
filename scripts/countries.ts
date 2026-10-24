// Regenerates src/lib/geo/countries.ts, one map point per country. Run by hand, rarely:
//
//   curl -sL $(npm view world-atlas@2.0.2 dist.tarball) | tar xz   # package/countries-50m.json
//   bun scripts/countries.ts package/countries-50m.json
//
// Each point sits inside the country's largest polygon, as close to its centroid as
// the shape allows (Chile and Norway's centroids are not in them). Natural Earth via
// world-atlas, public domain.
import { readFileSync, writeFileSync } from "node:fs";

const [path] = process.argv.slice(2);
if (!path) {
  console.error("usage: bun scripts/countries.ts <countries-50m.json>");
  process.exit(1);
}

type Ring = [number, number][];
type Geometry = { type: string; arcs: number[][] | number[][][]; properties: { name: string } };

const topo = JSON.parse(readFileSync(path, "utf8")) as {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: { countries: { geometries: Geometry[] } };
};
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as [number, number];
  });
});
const ring = (ids: number[]): Ring => ids.flatMap((id, k) => (k ? (id < 0 ? [...arcs[~id]].reverse() : arcs[id]).slice(1) : id < 0 ? [...arcs[~id]].reverse() : arcs[id]));

// Natural Earth's short names, spelled out; and places that are not countries to point at.
const RENAME: Record<string, string> = {
  "United States of America": "United States", "Dem. Rep. Congo": "DR Congo", "Central African Rep.": "Central African Republic",
  "Dominican Rep.": "Dominican Republic", "Eq. Guinea": "Equatorial Guinea", "Bosnia and Herz.": "Bosnia and Herzegovina",
  "Antigua and Barb.": "Antigua and Barbuda", "S. Sudan": "South Sudan", "St. Kitts and Nevis": "Saint Kitts and Nevis",
  "St. Vin. and Gren.": "Saint Vincent and the Grenadines", "Solomon Is.": "Solomon Islands", "Marshall Is.": "Marshall Islands",
  "Cayman Is.": "Cayman Islands", "Faeroe Is.": "Faroe Islands", "Falkland Is.": "Falkland Islands", "Cook Is.": "Cook Islands",
  "British Virgin Is.": "British Virgin Islands", "U.S. Virgin Is.": "US Virgin Islands", "Turks and Caicos Is.": "Turks and Caicos Islands",
  "N. Mariana Is.": "Northern Mariana Islands", "Fr. Polynesia": "French Polynesia", "W. Sahara": "Western Sahara",
  "Macedonia": "North Macedonia", "eSwatini": "Eswatini", "St-Martin": "Saint Martin", "St-Barthélemy": "Saint Barthélemy",
  "St. Pierre and Miquelon": "Saint Pierre and Miquelon", "São Tomé and Principe": "São Tomé and Príncipe",
};
const SKIP = new Set([
  "Antarctica", "Siachen Glacier", "Indian Ocean Ter.", "Ashmore and Cartier Is.", "Fr. S. Antarctic Lands", "Heard I. and McDonald Is.",
  "S. Geo. and the Is.", "Br. Indian Ocean Ter.", "N. Cyprus", "Pitcairn Is.", "Wallis and Futuna Is.", "Norfolk Island", "Åland",
  // "New Jersey" on every US status page.
  "Jersey",
]);

const area = (r: Ring) => r.reduce((s, [x, y], i) => s + x * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * y, 0) / 2;
function inRing(x: number, y: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const out: string[] = [];
for (const g of topo.objects.countries.geometries) {
  const raw = g.properties.name;
  if (SKIP.has(raw) || !g.arcs) continue;
  const polys = (g.type === "Polygon" ? [g.arcs as number[][]] : (g.arcs as number[][][])).map((p) => p.map(ring));
  // Mainland: the biggest outer ring. Skip rings that wrap the antimeridian.
  const outer = polys.map((p) => p[0]).filter((r) => Math.max(...r.map((p) => p[0])) - Math.min(...r.map((p) => p[0])) < 180);
  const main = outer.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
  if (!main) continue;
  const a = area(main);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < main.length; i++) {
    const [x0, y0] = main[i];
    const [x1, y1] = main[(i + 1) % main.length];
    const f = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  cx /= 6 * a;
  cy /= 6 * a;
  if (!inRing(cx, cy, main)) {
    // Nearest point inside, on a 0.1° grid over the ring's box.
    const xs = main.map((p) => p[0]);
    const ys = main.map((p) => p[1]);
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.1)
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.1) {
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bd && inRing(x, y, main)) (bd = d), (best = [x, y]);
      }
    if (best) [cx, cy] = best;
  }
  const name = RENAME[raw] ?? raw;
  out.push(`${name}|${+cy.toFixed(1)},${+cx.toFixed(1)}`);
}
out.sort();
writeFileSync(
  "src/lib/geo/countries.ts",
  `// Generated by scripts/countries.ts from Natural Earth (world-atlas countries-50m). ${out.length} countries.\n` +
    `// "Name|lat,lon;..." decoded once by places.ts.\n` +
    `export const COUNTRIES = ${JSON.stringify(out.join(";"))};\n`,
);
console.log(`${out.length} countries`);
