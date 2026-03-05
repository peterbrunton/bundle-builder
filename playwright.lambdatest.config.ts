/// <reference types="node" />
import { defineConfig } from "@playwright/test";

const {
  LT_USERNAME,
  LT_ACCESS_KEY,
  LT_WSS_HOST = "wss://cdp.lambdatest.com/playwright",
  LT_BUILD = `bundle-builder-${new Date().toISOString()}`,
  LT_PROJECT = "bundle-builder",
  LT_MATRIX = "all",
  LT_ENABLE_NETWORK_LOGS = "true",
  LT_ENABLE_CONSOLE_LOGS = "true",
  LT_ENABLE_VIDEO = "false",
  LT_GEO_LOCATION = "US",
  E2E_BASE_URL = "https://your-store.myshopify.com",
} = process.env;

if (!LT_USERNAME || !LT_ACCESS_KEY) {
  throw new Error("Missing LT_USERNAME or LT_ACCESS_KEY.");
}

function wsEndpointForDesktop(
  name: string,
  browserName: string,
  browserVersion: string,
  platform: string,
) {
  const capabilities = {
    browserName,
    browserVersion,
    "LT:Options": {
      platform,
      user: LT_USERNAME,
      accessKey: LT_ACCESS_KEY,
      build: LT_BUILD,
      project: LT_PROJECT,
      name,
      network: LT_ENABLE_NETWORK_LOGS === "true",
      console: LT_ENABLE_CONSOLE_LOGS === "true",
      video: LT_ENABLE_VIDEO === "true",
      geoLocation: LT_GEO_LOCATION,
    },
  };

  return `${LT_WSS_HOST}?capabilities=${encodeURIComponent(JSON.stringify(capabilities))}`;
}

function wsEndpointForIOS(name: string, deviceName: string, platformVersion: string) {
  const capabilities = {
    "LT:Options": {
      platformName: "ios",
      deviceName,
      platformVersion,
      isRealMobile: true,
      build: LT_BUILD,
      name,
      user: LT_USERNAME,
      accessKey: LT_ACCESS_KEY,
      network: LT_ENABLE_NETWORK_LOGS === "true",
      console: LT_ENABLE_CONSOLE_LOGS === "true",
      video: LT_ENABLE_VIDEO === "true",
      projectName: LT_PROJECT,
      geoLocation: LT_GEO_LOCATION,
    },
  };
  return `${LT_WSS_HOST}?capabilities=${encodeURIComponent(JSON.stringify(capabilities))}`;
}

const desktopProjects = [
  {
    name: "lt-mac-sequoia-safari-latest",
    use: {
      connectOptions: {
        wsEndpoint: wsEndpointForDesktop(
          "Bundle builder - macOS Sequoia Safari latest",
          "pw-webkit",
          "latest",
          "MacOS Sequoia",
        ),
        timeout: 120_000,
      },
    },
  },
  {
    name: "lt-mac-sonoma-safari-latest-1",
    use: {
      connectOptions: {
        wsEndpoint: wsEndpointForDesktop(
          "Bundle builder - macOS Sonoma Safari latest-1",
          "pw-webkit",
          "latest-1",
          "MacOS Sonoma",
        ),
        timeout: 120_000,
      },
    },
  },
  {
    name: "lt-mac-sequoia-chrome-latest",
    use: {
      connectOptions: {
        wsEndpoint: wsEndpointForDesktop(
          "Bundle builder - macOS Sequoia Chrome latest",
          "chrome",
          "latest",
          "MacOS Sequoia",
        ),
        timeout: 120_000,
      },
    },
  },
  {
    name: "lt-mac-sequoia-chrome-latest-1",
    use: {
      connectOptions: {
        wsEndpoint: wsEndpointForDesktop(
          "Bundle builder - macOS Sequoia Chrome latest-1",
          "chrome",
          "latest-1",
          "MacOS Sequoia",
        ),
        timeout: 120_000,
      },
    },
  },
  {
    name: "lt-mac-sequoia-chrome-latest-2",
    use: {
      connectOptions: {
        wsEndpoint: wsEndpointForDesktop(
          "Bundle builder - macOS Sequoia Chrome latest-2",
          "chrome",
          "latest-2",
          "MacOS Sequoia",
        ),
        timeout: 120_000,
      },
    },
  },
];

const iosProjects = [
  { name: "lt-ios-iphone-15-ios17", deviceName: "iPhone 15", platformVersion: "17" },
  { name: "lt-ios-iphone-15-pro-ios17", deviceName: "iPhone 15 Pro", platformVersion: "17" },
  { name: "lt-ios-iphone-16-ios18", deviceName: "iPhone 16", platformVersion: "18" },
  { name: "lt-ios-iphone-16-pro-ios18", deviceName: "iPhone 16 Pro", platformVersion: "18" },
  { name: "lt-ios-iphone-17-ios26", deviceName: "iPhone 17", platformVersion: "26" },
  { name: "lt-ios-iphone-17-pro-ios26", deviceName: "iPhone 17 Pro", platformVersion: "26" },
].map((device) => ({
  name: device.name,
  use: {
    connectOptions: {
      wsEndpoint: wsEndpointForIOS(
        `Bundle builder - ${device.deviceName} iOS ${device.platformVersion}`,
        device.deviceName,
        device.platformVersion,
      ),
      timeout: 120_000,
    },
    isMobile: true,
    hasTouch: true,
  },
}));

const matrix = LT_MATRIX.toLowerCase();
const selectedProjects =
  matrix === "desktop"
    ? desktopProjects
    : matrix === "ios"
      ? iosProjects
      : [...desktopProjects, ...iosProjects];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: selectedProjects,
});
