import { expect, test, type Page } from "@playwright/test";

const PAGES = ["/", "/c/hosting", "/c/ai", "/incidents", "/compare", "/compare/railway-vs-vercel", "/about", "/p/vercel", "/p/railway", "/p/heroku"];

/** Collect uncaught errors and console errors from our own origin. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

for (const path of PAGES) {
  test(`${path} renders without errors or sideways scroll`, async ({ page }) => {
    const errors = watchErrors(page);
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("h1, h2").first()).toBeVisible();
    // The page itself must fit the viewport; wide tables scroll inside their own box.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

test("the down-right-now banner links to the provider that is down", async ({ page }) => {
  await page.goto("/");
  const banner = page.locator("section.banner");
  await expect(banner).toBeVisible();
  // The fixtures have Vercel, Railway and Heroku all mid-incident.
  for (const slug of ["vercel", "railway", "heroku"]) await expect(banner.locator(`a[href="/p/${slug}"]`)).toBeVisible();
  await banner.locator('a[href="/p/heroku"]').click();
  await expect(page).toHaveURL(/\/p\/heroku$/);
  await expect(page.locator("main")).toContainText("Heroku");
});

test("the leaderboard links through to provider pages", async ({ page }) => {
  await page.goto("/c/hosting");
  const link = page.locator('main a[href^="/p/"]').first();
  const href = await link.getAttribute("href");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
});

test("unknown pages answer 404", async ({ page }) => {
  expect((await page.goto("/p/not-a-provider"))?.status()).toBe(404);
  expect((await page.goto("/c/not-a-category"))?.status()).toBe(404);
  expect((await page.goto("/nope"))?.status()).toBe(404);
  expect((await page.goto("/compare/vercel-vs-vercel"))?.status()).toBe(404);
  expect((await page.goto("/compare/vercel-vs-nope"))?.status()).toBe(404);
});

test("public JSON and badges", async ({ request }) => {
  const res = await request.get("/api/status.json");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.providers.length).toBeGreaterThanOrEqual(3);
  const badge = await request.get("/badge/vercel.svg");
  expect(badge.headers()["content-type"]).toContain("image/svg+xml");
  expect(await badge.text()).toContain("vercel");
});

test("the incident calendar filters the list to one day", async ({ page }) => {
  await page.goto("/incidents");
  const cells = page.locator(".cal a.cal-d");
  await expect(cells).toHaveCount(90);
  const hot = page.locator(".cal a.cal-d:not(.heat-0)").first();
  await hot.click();
  await expect(page).toHaveURL(/[?&]day=\d{4}-\d{2}-\d{2}/);
  await expect(page.locator('.cal a[aria-current="date"]')).toHaveCount(1);
  await expect(page.locator(".incident").first()).toBeVisible();
});

test("matchups have one canonical page and the picker goes there", async ({ page }) => {
  // Old query links redirect, keeping the order picked.
  await page.goto("/compare?p=vercel,railway");
  await expect(page).toHaveURL(/\/compare\/vercel-vs-railway$/);
  await expect(page.locator("h1")).toHaveText("Vercel vs Railway");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/compare\/railway-vs-vercel$/);
  await page.locator('select[name="b"]').selectOption("heroku");
  await expect(page).toHaveURL(/\/compare\/vercel-vs-heroku$/);
  await expect(page.locator("h1")).toHaveText("Vercel vs Heroku");
});

test("the sitemap lists provider and matchup pages", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain("/p/vercel</loc>");
  expect(xml).toContain("/compare/railway-vs-vercel</loc>");
});

test("the provider picker narrows the incidents page", async ({ page }) => {
  await page.goto("/incidents");
  await page.getByLabel("Provider", { exact: true }).selectOption("vercel");
  await expect(page).toHaveURL(/[?&]p=vercel/);
  await expect(page.locator(".cal a.cal-d")).toHaveCount(90);
});
