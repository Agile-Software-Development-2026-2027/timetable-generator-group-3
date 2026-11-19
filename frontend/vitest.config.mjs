import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.js"],
    // Leaves room for the 5 s asyncUtilTimeout set in vitest.setup.js
    // (the default test timeout is also 5 s).
    testTimeout: 15000,
  },
});
