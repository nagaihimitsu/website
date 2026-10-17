import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  testDir: "tests/production",
  workers: 1,
  use: { ...base.use, baseURL: "http://127.0.0.1:4174/website/" },
  webServer: {
    command:
      "npm run preview -- --port 4174 --base /website/ --outDir .test-build",
    url: "http://127.0.0.1:4174/website/",
    reuseExistingServer: false,
  },
  reporter: "list",
});
