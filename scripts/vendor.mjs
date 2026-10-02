// node_modules se ffmpeg.wasm aur fonts www/vendor mein copy karta hai (offline chalane ke liye)
import { cpSync, existsSync, rmSync, mkdirSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";

const jobs = [
  ["node_modules/@ffmpeg/ffmpeg/dist/esm", "www/vendor/ffmpeg"],
  ["node_modules/@ffmpeg/util/dist/esm", "www/vendor/util"],
  ["node_modules/@ffmpeg/core/dist/esm", "www/vendor/core"],
];

rmSync("www/vendor", { recursive: true, force: true });
for (const [from, to] of jobs) {
  if (!existsSync(from)) {
    console.error(`Nahi mila: ${from}  (npm install chala?)`);
    process.exit(1);
  }
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(to, "<-", readdirSync(to).join(", "));
}

const need = [
  "www/vendor/ffmpeg/index.js",
  "www/vendor/ffmpeg/worker.js",
  "www/vendor/core/ffmpeg-core.js",
  "www/vendor/core/ffmpeg-core.wasm",
];
const missing = need.filter((f) => !existsSync(f));
if (missing.length) {
  console.error("Ye files missing hain:", missing.join(", "));
  process.exit(1);
}

// ---- fonts (optional: na milen to app system fonts istemal karti hai) ----
const FAMILIES = {
  anton: "Anton",
  poppins: "Poppins",
  "noto-nastaliq-urdu": "Noto Nastaliq Urdu",
  "noto-naskh-arabic": "Noto Naskh Arabic",
};
const WEIGHTS = new Set(["400", "700", "800"]);
const manifest = [];
mkdirSync("www/vendor/fonts", { recursive: true });
for (const [pkg, family] of Object.entries(FAMILIES)) {
  const dir = `node_modules/@fontsource/${pkg}/files`;
  if (!existsSync(dir)) {
    console.warn(`font nahi mila (skip): ${pkg}`);
    continue;
  }
  for (const f of readdirSync(dir)) {
    const m = f.match(/^(.+)-(latin|arabic)-(\d+)-normal\.woff2$/);
    if (!m || !WEIGHTS.has(m[3])) continue;
    copyFileSync(`${dir}/${f}`, `www/vendor/fonts/${f}`);
    manifest.push({ family, file: f, weight: Number(m[3]), subset: m[2] });
  }
}
writeFileSync("www/vendor/fonts/fonts.json", JSON.stringify(manifest, null, 1));
console.log(`fonts: ${manifest.length} files`);
console.log("vendor OK");
