import { defineConfig } from "vitest/config";

// Separate from vite.config.js deliberately — this project has no component
// tests yet, just the offline-validator suite (Work Order 03 A6), which
// needs no DOM. "node" environment + fake-indexeddb's own setup (imported
// directly in the test file) covers it; Web Crypto is Node's native global.
export default defineConfig({
  test: {
    environment: "node",
  },
});
