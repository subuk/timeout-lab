import { defineConfig } from "vite";
export default defineConfig({
  publicDir: false,
  build: {
    target: "es2022",
    outDir: "public",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: "src/worker.ts",
      formats: ["iife"],
      name: "LabWorker",
      fileName: () => "worker.js",
    },
  },
});
