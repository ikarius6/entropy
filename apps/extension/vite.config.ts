import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite plugin that re-bundles the content script as a self-contained IIFE
 * after the main build. MV3 content scripts cannot use ES module imports.
 */
function inlineContentScript() {
  return {
    name: "inline-content-script",
    async closeBundle() {
      await build({
        configFile: false,
        build: {
          write: true,
          outDir: resolve(__dirname, "dist/content"),
          emptyOutDir: false,
          lib: {
            entry: resolve(__dirname, "dist/content/content-script.js"),
            formats: ["iife"],
            name: "EntropyContentScript",
            fileName: () => "content-script.js"
          },
          rollupOptions: {
            output: { extend: true }
          }
        }
      });
    }
  };
}

export default {
  publicDir: "public",
  base: "",
  plugins: [inlineContentScript()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
        "background/service-worker": "src/background/service-worker.ts",
        "content/content-script": "src/content/content-script.ts"
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
};
