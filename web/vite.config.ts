import { defineConfig } from "vite";

/**
 * The web app is a separate Vite root that imports the engine straight from
 * `src/` rather than from `dist/`. There is no publish step between the two,
 * so an engine change is visible in the browser on the next reload without a
 * library rebuild, and the bundler type-checks both trees as one program.
 */
export default defineConfig({
  root: __dirname,
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    port: 5173,
  },
});
