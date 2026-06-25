import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Test harness for the web app (ST-4 #40). DOM tests (Layer 3) need jsdom;
// the pure-logic Layer 2 suites don't, but a single jsdom env keeps config flat.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
