import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const sourcePath = resolve(process.cwd(), "manifest.json");
const publicDir = resolve(process.cwd(), "public");
const destinationPath = resolve(publicDir, "manifest.json");

mkdirSync(publicDir, { recursive: true });
copyFileSync(sourcePath, destinationPath);
