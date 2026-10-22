// The Railway cron service runs this every 5 minutes. It asks the web service to
// poll (over Railway's private network) and exits, so it's only billed while it runs.
// No dependencies on purpose.
const url = process.env.POLL_URL;
const secret = process.env.CRON_SECRET;
if (!url || !secret) {
  console.error("POLL_URL and CRON_SECRET must be set");
  process.exit(1);
}

const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(120_000),
});
const text = await res.text();
console.log(res.status, text);
process.exit(res.ok ? 0 : 1);
