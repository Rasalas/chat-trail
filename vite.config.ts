import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/chrome",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: "src/popup/index.html",
        review: "src/review/index.html",
        content: "src/content/index.ts",
        background: "src/background/index.ts"
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
