import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/service_worker.ts"],
  outDir: "./public",
  format: "iife",
  target: "es2020",
  outExtension: () => ({ js: ".js" }),
  splitting: false,
  platform: "browser",
  minify: true,
  loader: {
    ".wasm": "binary",
  },
});
