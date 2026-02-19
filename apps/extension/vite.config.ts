import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite plugin that bundles the content script as a self-contained IIFE
 * directly from TypeScript source after the main build completes.
 * MV3 content scripts cannot use ES module imports, so they must be
 * bundled as IIFE. We build from source (not from the intermediate JS)
 * to avoid double-processing that can produce non-UTF-8 output.
 *
 * After bundling, all non-ASCII characters are escaped to \uXXXX so that
 * Chrome's extension loader always accepts the file as valid UTF-8.
 * Some dependencies (e.g. nostr-tools) embed Unicode sentinel values like
 * U+FFFF as string literals which Chrome rejects in content scripts.
 */
function buildContentScriptIife() {
  return {
    name: "build-content-script-iife",
    async closeBundle() {
      const outFile = resolve(__dirname, "dist/content/content-script.js");

      await build({
        configFile: false,
        resolve: {
          alias: {
            "@entropy/core": resolve(__dirname, "../../packages/core/src/index.ts")
          }
        },
        build: {
          write: true,
          outDir: resolve(__dirname, "dist/content"),
          emptyOutDir: false,
          lib: {
            entry: resolve(__dirname, "src/content/content-script.ts"),
            formats: ["iife"],
            name: "EntropyContentScript",
            fileName: () => "content-script.js"
          },
          rollupOptions: {
            output: {
              extend: true,
              sanitizeFileName: (name) => name
            }
          }
        }
      });

      const raw = readFileSync(outFile, "utf8");
      const escaped = raw.replace(/[^\x00-\x7F]/gu, (char) => {
        const cp = char.codePointAt(0) ?? 0;
        return cp > 0xffff
          ? `\\u{${cp.toString(16)}}`
          : `\\u${cp.toString(16).padStart(4, "0")}`;
      });
      writeFileSync(outFile, escaped, "utf8");
    }
  };
}

export default {
  publicDir: "public",
  base: "",
  plugins: [buildContentScriptIife()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        dashboard: resolve(__dirname, "dashboard.html"),
        "background/service-worker": "src/background/service-worker.ts"
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
};
