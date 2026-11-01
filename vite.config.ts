import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";

export default defineConfig({
  base: isGitHubPages ? "/jamr-tmbl-pryk/" : "/",
  plugins: [svelte()],
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: 4096 },
  server: { host: "0.0.0.0" }
});
