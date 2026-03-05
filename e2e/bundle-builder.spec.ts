/// <reference types="node" />
import { expect, test } from "@playwright/test";
import {
  dismissBlockingDialogsIfPresent,
  dismissCookieBannerIfPresent,
  resilientClick,
  unlockStorefrontIfNeeded,
} from "./helpers";

const testMode = process.env.BUNDLE_TEST_MODE || "mock";
const pagePath = process.env.BUNDLE_PAGE_PATH || "/pages/build-your-own-bundle";
const pageUrl = process.env.BUNDLE_PAGE_URL || pagePath;

async function selectMinimumRequiredItems(
  page: import("@playwright/test").Page,
  root: import("@playwright/test").Locator,
) {
  const categories = JSON.parse((await root.getAttribute("data-categories")) || "[]");

  for (const category of categories) {
    const role = category.key;
    const min = Number(category.min ?? 0);
    if (!role || !Number.isFinite(min) || min <= 0) continue;

    const roleButtons = root.locator(`.bundle-builder__item[data-role="${role}"] [data-action="toggle"]`);
    const count = await roleButtons.count();
    if (count < min) {
      throw new Error(
        `Insufficient products for role "${role}". Required ${min}, found ${count}.`,
      );
    }

    for (let tries = 0; tries < 8; tries += 1) {
      const selectedCount = await root
        .locator(`.bundle-builder__item[data-role="${role}"] [data-action="toggle"][data-selected="true"]`)
        .count();
      if (selectedCount >= min) break;

      const nextUnselected = root
        .locator(`.bundle-builder__item[data-role="${role}"] [data-action="toggle"]:not([data-selected="true"])`)
        .first();
      await resilientClick(page, nextUnselected);
      await page.waitForTimeout(120);
    }

    const finalSelectedCount = await root
      .locator(`.bundle-builder__item[data-role="${role}"] [data-action="toggle"][data-selected="true"]`)
      .count();
    if (finalSelectedCount < min) {
      throw new Error(
        `Unable to select enough items for role "${role}". Required ${min}, selected ${finalSelectedCount}.`,
      );
    }
  }
}

test.describe("Bundle builder live page", () => {
  test("can build a valid bundle and send add-bundle request", async ({ page, baseURL }) => {
    const resolvedBaseURL = baseURL || "";
    const hasExplicitPageURL = !!process.env.BUNDLE_PAGE_URL;
    const hasConfiguredBase =
      !!resolvedBaseURL && !resolvedBaseURL.includes("your-store.myshopify.com");

    test.skip(
      !hasExplicitPageURL && !hasConfiguredBase,
      "Set E2E_BASE_URL or BUNDLE_PAGE_URL to a real storefront URL.",
    );

    if (testMode === "mock") {
      await page.route("**/apps/**/price", async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              rulebook: {
                categories: [
                  { key: "full", label: "Full", min: 1, max: 2 },
                  { key: "small", label: "Small", min: 1, max: 4 },
                ],
                tiers: [],
              },
            }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ discountedCents: 1000, signature: "test_sig" }),
        });
      });

      await page.route("**/apps/**/add-bundle", async (route) => {
        const payload = JSON.parse(route.request().postData() || "{}");
        const components = payload.components || [];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            received: components.length,
            cart: { item_count: 1 },
          }),
        });
      });
    }

    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await unlockStorefrontIfNeeded(page);
    await dismissCookieBannerIfPresent(page);
    await dismissBlockingDialogsIfPresent(page);

    const root = page.locator(".bundle-builder").first();
    await expect(root).toBeVisible();

    await selectMinimumRequiredItems(page, root);

    const commit = root.locator("[data-bundle-action='commit']");
    await expect(commit).toBeEnabled({ timeout: 10000 });

    let addBundleRequestSeen = false;
    page.on("request", (req) => {
      if (req.url().includes("/add-bundle") && req.method() === "POST") {
        addBundleRequestSeen = true;
      }
    });

    await resilientClick(page, commit);
    await expect.poll(() => addBundleRequestSeen, { timeout: 12000 }).toBeTruthy();
  });
});
