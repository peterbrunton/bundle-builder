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

const expectedRulebookId = process.env.BUNDLE_EXPECT_RULEBOOK_ID || "bundle-config-1";
const deviceRole = process.env.BUNDLE_DEVICE_ROLE || "full";
const addonRole = process.env.BUNDLE_ADDON_ROLE || "small";
const requiredDeviceCount = Number(process.env.BUNDLE_REQUIRED_DEVICE_COUNT || "1");
const requiredAddonCount = Number(process.env.BUNDLE_REQUIRED_ADDON_COUNT || "2");

async function gotoBundlePage(page: import("@playwright/test").Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      return;
    } catch (error) {
      if (attempt === 1) throw error;
      await page.waitForTimeout(1000);
    }
  }
}

async function findBundleRoot(page: import("@playwright/test").Page) {
  const root = page
    .locator(".bundle-builder, [data-bundle-version='v1'], [data-bundle-config-id]")
    .first();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const visible = await root.isVisible().catch(() => false);
    if (visible) return root;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {});
    await dismissCookieBannerIfPresent(page);
    await page.waitForTimeout(500);
  }
  await expect(root).toBeVisible({ timeout: 15_000 });
  return root;
}

async function selectItemsByRole(
  page: import("@playwright/test").Page,
  root: import("@playwright/test").Locator,
  role: string,
  requiredCount: number,
) {
  const toggles = root.locator(`.bundle-builder__item[data-role="${role}"] [data-action="toggle"]`);
  const count = await toggles.count();
  if (count < requiredCount) {
    throw new Error(`Role "${role}" needs ${requiredCount} item(s), found ${count}.`);
  }

  for (let tries = 0; tries < 8; tries += 1) {
    const selectedCount = await root
      .locator(`.bundle-builder__item[data-role="${role}"] [data-action="toggle"][data-selected="true"]`)
      .count();
    if (selectedCount >= requiredCount) break;

    const nextUnselected = root
      .locator(`.bundle-builder__item[data-role="${role}"] [data-action="toggle"]:not([data-selected="true"])`)
      .first();
    await resilientClick(page, nextUnselected);
    await page.waitForTimeout(120);
  }

  const finalSelectedCount = await root
    .locator(`.bundle-builder__item[data-role="${role}"] [data-action="toggle"][data-selected="true"]`)
    .count();
  if (finalSelectedCount < requiredCount) {
    throw new Error(
      `Unable to select enough items for role "${role}". Required ${requiredCount}, selected ${finalSelectedCount}.`,
    );
  }
}

test.describe("Bundle builder recurring scenario", () => {
  test("adds bundle when 1 device and 2 add-ons are selected", async ({
    page,
    baseURL,
  }) => {
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
                categories: [{ key: "recurring", label: "Recurring products", min: 1, max: 1 }],
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
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, cart: { item_count: 1 } }),
        });
      });
    }

    await gotoBundlePage(page);
    await unlockStorefrontIfNeeded(page);
    await dismissCookieBannerIfPresent(page);
    await dismissBlockingDialogsIfPresent(page);

    const root = await findBundleRoot(page);

    const configuredRulebookId = (await root.getAttribute("data-bundle-config-id")) || "";
    expect(configuredRulebookId).toBeTruthy();
    expect(configuredRulebookId).toBe(expectedRulebookId);

    await selectItemsByRole(page, root, deviceRole, requiredDeviceCount);
    await selectItemsByRole(page, root, addonRole, requiredAddonCount);

    const status = root.locator("[data-bundle-status]");
    await expect(status).not.toContainText(/requirements not met|select items to build/i);

    const commit = root.locator("[data-bundle-action='commit']");
    await expect(commit).toBeEnabled({ timeout: 10000 });

    const addBundleReqPromise = page.waitForRequest(
      (req) => req.url().includes("/add-bundle") && req.method() === "POST",
    );
    const addBundleResPromise = page.waitForResponse(
      (res) => res.url().includes("/add-bundle") && res.request().method() === "POST",
    );

    await resilientClick(page, commit);
    const addBundleReq = await addBundleReqPromise;
    const addBundleRes = await addBundleResPromise;
    expect(addBundleRes.ok()).toBeTruthy();

    const payload = JSON.parse(addBundleReq.postData() || "{}");
    expect(payload).toHaveProperty("bundleId");
    expect(typeof payload.bundleId).toBe("string");
    expect(payload.bundleId.length).toBeGreaterThan(0);

    expect(payload).toHaveProperty("rulebookId", expectedRulebookId);
    expect(payload).toHaveProperty("parentVariantId");
    expect(String(payload.parentVariantId || "").length).toBeGreaterThan(0);
    expect(Array.isArray(payload.components)).toBeTruthy();
    const counts = (payload.components || []).reduce(
      (acc: Record<string, number>, component: { role?: string }) => {
        const role = String(component?.role || "unknown");
        acc[role] = (acc[role] || 0) + 1;
        return acc;
      },
      {},
    );
    expect(counts[deviceRole] || 0).toBeGreaterThanOrEqual(requiredDeviceCount);
    expect(counts[addonRole] || 0).toBeGreaterThanOrEqual(requiredAddonCount);
  });
});
