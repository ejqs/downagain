import type { Impact, Status } from "@/db/schema";

export type { Impact, Status };

export interface NormalizedComponent {
  name: string;
  status: Status;
  group?: string;
}

export interface NormalizedUpdate {
  externalId: string;
  status: string;
  body: string;
  postedAt: Date;
}

export interface NormalizedIncident {
  externalId: string;
  title: string;
  impact: Impact;
  status: string; // lower-case: investigating | identified | monitoring | resolved | postmortem
  startedAt: Date;
  monitoringAt: Date | null;
  resolvedAt: Date | null;
  sourceUpdatedAt: Date | null;
  url: string | null;
  components: string[];
  worstComponentStatus: Status | null;
  postmortem: boolean;
  updates: NormalizedUpdate[];
  raw: unknown;
}

/**
 * What an adapter learned in one poll. A field is undefined when the source said
 * "not modified" (304), so the poller keeps what it already has for that part.
 */
export interface ProviderSnapshot {
  status?: Status;
  components?: NormalizedComponent[];
  incidents?: NormalizedIncident[];
  raw?: Record<string, unknown>;
}

export interface ProviderSource {
  slug: string;
  sourceKind: "statuspage" | "railway" | "heroku";
  sourceUrl: string;
  statusPageUrl: string;
}

export type Getter = (url: string) => Promise<{ notModified: true } | { notModified: false; body: unknown }>;
