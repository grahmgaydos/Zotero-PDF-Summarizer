// Packages addon/ into dist/pdf-auto-summariser-<version>.xpi.
// An .xpi is just a zip file — Zotero's "Install Plugin From File" picker
// accepts it directly.

import { mkdirSync, readFileSync, createWriteStream, statSync, readdirSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(process.cwd());
const ADDON = resolve(ROOT, "addon");
const DIST = resolve(ROOT, "dist");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const OUT = resolve(DIST, `pdf-auto-summariser-${pkg.version}.xpi`);

mkdirSync(DIST, { recursive: true });

// Use system `zip` if available — it's the cleanest cross-platform-ish path.
// Fall back to a Node implementation if not.
try {
  execFileSync("zip", ["--version"], { stdio: "ignore" });
  // -r recurse, -X strip extra attrs, -9 max compression
  // Run inside addon/ so the manifest is at the archive root.
  execFileSync(
    "zip",
    ["-r", "-X", "-9", OUT, ".", "-x", "*.DS_Store", "-x", "__MACOSX/*"],
    { cwd: ADDON, stdio: "inherit" }
  );
  console.log(`packaged: ${OUT}`);
} catch {
  console.error(
    "system `zip` not found. Install it (apt/brew/choco install zip) and retry.\n" +
    "Alternative: zip the contents of addon/ manually so manifest.json is at the archive root, " +
    "and rename to .xpi"
  );
  process.exit(1);
}
