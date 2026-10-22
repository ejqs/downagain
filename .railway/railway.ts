// Railway infrastructure for downagain.dev: one web service, Postgres, and a
// cron service that asks web to poll every 5 minutes.
//
// EJ already has a Railway project. Before applying this for the first time:
//   railway link                 # pick the existing project
//   railway config plan          # check it matches what's there; rename resources here if needed
// Only run `railway config apply` after reading the plan.
//
// Secrets are not in this file. Set CRON_SECRET once on the web service
// (any long random string); the poller reads it from web by reference.
import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const db = postgres("Postgres");

  const web = service("downagain", {
    source: github("ejqs/downagain", { branch: "main" }),
    build: "bun run build",
    // Migrations and the provider list are applied before each deploy goes live.
    preDeploy: "bun run db:migrate && bun run db:seed",
    start: "bun run start",
    healthcheck: "/api/health",
    replicas: 1, // the page cache lives in this process; more replicas need a shared cache handler
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      CRON_SECRET: preserve(),
      // Set by hand in Railway; without it incidents are graded by the rules only.
      ANTHROPIC_API_KEY: preserve(),
      PORT: "8080",
      NEXT_PUBLIC_SITE_URL: "https://downagain.dev",
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: "5f60967a-e8ec-4965-85ef-cbcf07e4c968",
    },
    // downagain.dev is attached; DNS is set up in Cloudflare via Railway's one-click flow.
    domains: ["downagain.dev"],
  });

  const poller = service("poller", {
    source: github("ejqs/downagain", { branch: "main" }),
    build: "echo poller needs no build",
    start: "bun scripts/cron-trigger.mjs",
    deploy: { cronSchedule: "*/5 * * * *", restartPolicyType: "NEVER" },
    env: {
      POLL_URL: "http://${{downagain.RAILWAY_PRIVATE_DOMAIN}}:8080/api/cron/poll",
      CRON_SECRET: web.env.CRON_SECRET,
    },
  });

  return project("downagain", { resources: [db, web, poller] });
});
