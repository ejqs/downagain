import type { Getter, ProviderSnapshot, ProviderSource } from "@/lib/types";
import { fetchStatuspage } from "./statuspage";
import { fetchRailway } from "./railway";
import { fetchHeroku } from "./heroku";

const ADAPTERS = {
  statuspage: fetchStatuspage,
  railway: fetchRailway,
  heroku: fetchHeroku,
} as const;

export function readProvider(p: ProviderSource, get: Getter): Promise<ProviderSnapshot> {
  return ADAPTERS[p.sourceKind](p.sourceUrl, p.statusPageUrl, get);
}
