/**
 * package-extension.mjs
 *
 * Packages the already-built extension dist/ folder into a distributable .zip
 * file inside releases/ at the monorepo root.
 *
 * Usage (from apps/extension/):
 *   node scripts/package-extension.mjs [chrome|firefox]
 *
 * The BROWSER_TARGET env var is also respected, matching the build scripts.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const monorepoRoot  = resolve(extensionRoot, "../..");

const target  = process.argv[2] || process.env.BROWSER_TARGET || "chrome";
const distDir = resolve(extensionRoot, "dist");

if (!existsSync(distDir)) {
  console.error(`❌  dist/ not found — run the build first: pnpm run build${target === "firefox" ? ":firefox" : ""}`);
  process.exit(1);
}

// Read version from the extension's package.json
const pkg     = JSON.parse(readFileSync(resolve(extensionRoot, "package.json"), "utf8"));
const version = pkg.version ?? "0.0.0";

const releasesDir = resolve(monorepoRoot, "releases");
mkdirSync(releasesDir, { recursive: true });

const zipName   = `entropy-extension-${target}-v${version}.zip`;
const zipPath   = join(releasesDir, zipName);
const output    = createWriteStream(zipPath);
const archive   = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  const kb = (archive.pointer() / 1024).toFixed(1);
  console.log(`✅  ${zipName}  (${kb} KB)`);
  console.log(`    → ${zipPath}`);
});

archive.on("warning", (err) => {
  if (err.code === "ENOENT") console.warn("⚠️ ", err.message);
  else throw err;
});
archive.on("error", (err) => { throw err; });

archive.pipe(output);
archive.directory(distDir, false); // add dist/ contents at zip root
archive.finalize();
