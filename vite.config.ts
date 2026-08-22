import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/chrome",
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: "src/popup/index.html",
        review: "src/review/index.html",
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
