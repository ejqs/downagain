import { AREA_BLURB, TIER_BLURB } from "@/lib/severity";

/** One-line answers behind the "?" next to a metric. Method details stay on /about. */
export const GLOSSARY = {
  uptime: "Time not covered by a Sev 1 the provider posted itself. A best case.",
  grade: "Severity weight × minutes, summed over the window. Fewer points, better grade.",
  production: AREA_BLURB.production,
  shipping: AREA_BLURB.shipping,
  incidents: "Everything posted on the status page except scheduled maintenance.",
  sev1: TIER_BLURB[1],
  sev2: TIER_BLURB[2],
  sev3: TIER_BLURB[3],
  sev4: TIER_BLURB[4],
  sev1Downtime: "Total minutes of Sev 1 incidents, as posted.",
  mttr: "Median time to resolve. Half of incidents were fixed faster.",
  longest: "Longest single incident, start to resolved.",
  security: "Incidents the provider flagged as security. They count one tier higher.",
  trend: "Incident count, last 6 months against the 6 before.",
  postmortems: "Sev 1–2 incidents with a published write-up.",
  updateGap: "Median time between status page updates during an incident.",
  updatesPer: "Status page updates per incident, on average.",
  sinceLast: "Time since the last counted incident was resolved.",
  heatmap: "Severity weight × minutes per UTC day, every provider shown. Same points as grades.",
  dns: "Incidents with DNS in the title or components, 90 days.",
} as const;
