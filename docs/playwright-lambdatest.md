# Playwright + LambdaTest

This project supports:

- local Playwright runs
- LambdaTest desktop macOS matrix
- LambdaTest iOS real-device matrix (iPhone 15+)

## 1) Install

```bash
npm install
npm run test:e2e:install
```

## 2) Required env

```bash
export E2E_BASE_URL="https://your-store.myshopify.com"
export BUNDLE_PAGE_PATH="/pages/build-your-own-bundle"
export BUNDLE_STOREFRONT_PASSWORD="your-store-password"
```

Optional:

```bash
export BUNDLE_PAGE_URL="https://your-store.myshopify.com/pages/build-your-own-bundle"
```

## 3) Local runs

Generic live-page flow:

```bash
export BUNDLE_TEST_MODE="live"
npm run test:e2e:live
```

Recurring service-contract flow (`1 full + 2 small`):

```bash
export BUNDLE_TEST_MODE="live"
export BUNDLE_EXPECT_RULEBOOK_ID="bundle-config-1"
export BUNDLE_DEVICE_ROLE="full"
export BUNDLE_ADDON_ROLE="small"
export BUNDLE_REQUIRED_DEVICE_COUNT="1"
export BUNDLE_REQUIRED_ADDON_COUNT="2"
npm run test:e2e:recurring
```

## 4) LambdaTest setup

```bash
export LT_USERNAME="..."
export LT_ACCESS_KEY="..."
export LT_BUILD="bundle-builder-$(date +%Y%m%d-%H%M)"
export LT_PROJECT="bundle-builder"
export BUNDLE_TEST_MODE="live"
```

## 5) LambdaTest desktop matrix

Run generic flow:

```bash
npm run test:e2e:lambdatest:desktop
```

Run recurring flow:

```bash
npm run test:e2e:lambdatest:recurring:desktop
```

Default desktop projects (`playwright.lambdatest.config.ts`):

- macOS Sequoia + Safari `latest`
- macOS Sonoma + Safari `latest-1`
- macOS Sequoia + Chrome `latest`
- macOS Sequoia + Chrome `latest-1`
- macOS Sequoia + Chrome `latest-2`

## 6) LambdaTest iOS real-device matrix (iPhone 15+)

Run generic flow:

```bash
npm run test:e2e:lambdatest:ios
```

Run recurring flow:

```bash
npm run test:e2e:lambdatest:recurring:ios
```

Default iOS projects (`playwright.lambdatest.config.ts`):

- iPhone 15 / iOS 17
- iPhone 15 Pro / iOS 17
- iPhone 16 / iOS 18
- iPhone 16 Pro / iOS 18
- iPhone 17 / iOS 26
- iPhone 17 Pro / iOS 26

## 7) Matrix selector

`playwright.lambdatest.config.ts` supports:

- `LT_MATRIX=desktop`
- `LT_MATRIX=ios`
- `LT_MATRIX=all` (default)

## 8) Reports

Local report:

```bash
npx playwright show-report
```

LambdaTest report:

- LambdaTest dashboard -> your `LT_BUILD` value
- includes pass/fail, video, network logs, console logs
