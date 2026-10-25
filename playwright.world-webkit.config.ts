import { defineConfig } from "@playwright/test";
// Safariと同系統のWebKitで、可変高さ・独立スクロール・選択を検査する。
export default defineConfig({
  testDir: "tests/webkit", workers: 1, timeout: 90000,
  use: { browserName: "webkit", baseURL: "http://127.0.0.1:5173", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, trace: "retain-on-failure" },
  webServer: { command: "npm run dev -- --port 5173", url: "http://127.0.0.1:5173", reuseExistingServer: !process.env.CI },
  reporter: "list",
});
