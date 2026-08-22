import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/chrome",
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: "src/content/index.ts",
      output: {
        format: "iife",
        entryFileNames: "assets/content.js",
        inlineDynamicImports: true
      }
    }
  }
});
