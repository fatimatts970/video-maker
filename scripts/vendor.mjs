// node_modules se ffmpeg.wasm ki files www/vendor mein copy karta hai (offline chalane ke liye)
import { cpSync, existsSync, rmSync, mkdirSync, readdirSync } from "node:fs";

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
console.log("vendor OK");
