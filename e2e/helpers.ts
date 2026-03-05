/// <reference types="node" />
import type { Locator, Page } from "@playwright/test";

export async function unlockStorefrontIfNeeded(page: Page) {
  const password = process.env.BUNDLE_STOREFRONT_PASSWORD;
  if (!password) return;

  const passwordInput = page.locator(
    'input[type="password"][name="password"], input[type="password"]#password, input[type="password"]',
  );
  if (!(await passwordInput.first().isVisible().catch(() => false))) return;

  await passwordInput.first().fill(password);
  const submit = page.locator(
    'button[type="submit"], input[type="submit"], button:has-text("Enter")',
  );
  await submit.first().click();
}

export async function dismissCookieBannerIfPresent(page: Page) {
  const privacyDialog = page
    .getByRole("alertdialog")
    .filter({ hasText: /privacy|cookie/i })
    .first();
  if (await privacyDialog.isVisible().catch(() => false)) {
    const acceptInDialog = privacyDialog
      .getByRole("button", { name: /accept|allow all|accept all/i })
      .first();
    if (await acceptInDialog.isVisible().catch(() => false)) {
      await acceptInDialog.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      return;
    }
  }

  const selectors = [
    "#onetrust-accept-btn-handler",
    "button#accept-recommended-btn-handler",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "button:has-text('Accept')",
    "button:has-text('Accept all')",
    "button:has-text('Accept All')",
    "button:has-text('Allow all')",
    "button:has-text('Allow All')",
    "button:has-text('I agree')",
    "button:has-text('Got it')",
    "[data-testid='cookie-banner-accept']",
    "[data-cookie-banner-accept]",
  ];

  for (const selector of selectors) {
    const target = page.locator(selector).first();
    const visible = await target.isVisible().catch(() => false);
    if (!visible) continue;
    await target.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(250);
    return;
  }

  const iframes = page.frames();
  for (const frame of iframes) {
    for (const selector of selectors) {
      const target = frame.locator(selector).first();
      const visible = await target.isVisible().catch(() => false);
      if (!visible) continue;
      await target.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(250);
      return;
    }
  }
}

export async function dismissBlockingDialogsIfPresent(page: Page) {
  for (let i = 0; i < 4; i += 1) {
    const regionDialog = page
      .getByRole("dialog")
      .filter({ hasText: /are you in the right place/i })
      .first();
    if (await regionDialog.isVisible().catch(() => false)) {
      const close = regionDialog.getByRole("button", { name: /close/i }).first();
      if (await close.isVisible().catch(() => false)) {
        await close.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(250);
      }
    }

    const popupDialog = page.getByRole("dialog").filter({ hasText: /popup form|mystery offer/i }).first();
    if (await popupDialog.isVisible().catch(() => false)) {
      const close = popupDialog.getByRole("button", { name: /close dialog|close/i }).first();
      if (await close.isVisible().catch(() => false)) {
        await close.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(250);
      } else {
        const noThanks = popupDialog.getByRole("button", { name: /no thanks/i }).first();
        if (await noThanks.isVisible().catch(() => false)) {
          await noThanks.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(250);
        }
      }
    }

    const locationSwitcherDialog = page.locator("dialog.location-switcher__dialog[open]").first();
    if (await locationSwitcherDialog.isVisible().catch(() => false)) {
      const closeBtn = page
        .locator(
          ".location-switcher__close, .location-switcher [aria-label='Close'], .location-switcher button:has-text('Close')",
        )
        .first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(200);
      } else {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(200);
      }
    }

    await page
      .evaluate(() => {
        const dialogs = document.querySelectorAll("dialog.location-switcher__dialog[open]");
        dialogs.forEach((dialog) => {
          const d = dialog as HTMLDialogElement;
          if (typeof d.close === "function") d.close();
          d.removeAttribute("open");
        });

        const switchers = document.querySelectorAll("location-switcher");
        switchers.forEach((node) => {
          node.remove();
        });

        const locationSwitcherNodes = document.querySelectorAll("[class*='location-switcher__']");
        locationSwitcherNodes.forEach((node) => node.remove());
      })
      .catch(() => {});

    const anyDialogVisible = await page.getByRole("dialog").first().isVisible().catch(() => false);
    if (!anyDialogVisible) return;
  }
}

export async function resilientClick(page: Page, locator: Locator) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ timeout: 2500 });
      return;
    } catch {
      await dismissBlockingDialogsIfPresent(page);
      await page.waitForTimeout(120);
    }
  }

  try {
    await locator.scrollIntoViewIfNeeded();
    await locator.click({ force: true, timeout: 1500 });
    return;
  } catch {
    await locator.evaluate((el) => (el as HTMLElement).click());
  }
}
