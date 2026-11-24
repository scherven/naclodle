import { defineConfig } from "vite";

// Relative base so the built site works from any static host or subpath.
export default defineConfig({
  base: "./",
  test: { include: ["src/**/*.test.ts", "scripts/**/*.test.ts"] },
} as never);
