import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const target = process.env.BROWSER_TARGET || "chrome";
const sourcePath = resolve(process.cwd(), "manifest.json");
const publicDir = resolve(process.cwd(), "public");
const destinationPath = resolve(publicDir, "manifest.json");

mkdirSync(publicDir, { recursive: true });

const manifest = JSON.parse(readFileSync(sourcePath, "utf8"));

if (target === "firefox") {
  // Firefox MV3 uses background.scripts instead of service_worker
  manifest.background = {
    scripts: ["background/service-worker.js"],
    type: "module"
  };

  // Firefox does not support "world": "MAIN" in content_scripts — use
  // web_accessible_resources with a script tag injector instead.
  manifest.content_scripts = manifest.content_scripts.filter(
    (cs) => !cs.world || cs.world !== "MAIN"
  );
} else {
  // Chrome ignores browser_specific_settings, but remove it for cleanliness
  delete manifest.browser_specific_settings;
}

writeFileSync(destinationPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
