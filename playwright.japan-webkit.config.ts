import { defineConfig } from "@playwright/test";
// JAPANの2DレイアウトだけをWebKitで確認する。Chromium専用CDP入力試験は対象外。
export default defineConfig({
  testDir: "tests/e2e", testMatch: "japan-mode.spec.ts", grep: /固定地図/, workers: 1, timeout: 90000,
  use: { browserName: "webkit", baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  webServer: { command: "npm run dev -- --port 5173", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI },
  reporter: "list",
});
