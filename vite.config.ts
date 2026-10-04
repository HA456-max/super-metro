import { defineConfig } from "vite";

// GitHub Pages serves this project from /<repository-name>/.
// A relative base also keeps the built game portable to other static hosts.
export default defineConfig({
  base: "./",
});
