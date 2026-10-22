import type { Impact, SourceKind, Status } from "@/db/schema";

export type { Impact, SourceKind, Status };

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
  /**
   * Cloud regions the provider said were affected ("us-east-1"). Empty or missing
   * means global or not stated. A single region caps the severity, see severity.ts.
   */
  regions?: string[];
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
  sourceKind: SourceKind;
  sourceUrl: string;
  statusPageUrl: string;
}

export interface GetOptions {
  /** "text" returns the body as a string (RSS); default parses JSON. */
  as?: "json" | "text";
  /** Skip If-None-Match: for small feeds the adapter needs in full every poll. */
  fresh?: boolean;
  /** Allow a longer timeout for multi-MB history files. */
  large?: boolean;
}

export type Getter = (url: string, opts?: GetOptions) => Promise<{ notModified: true } | { notModified: false; body: unknown }>;
