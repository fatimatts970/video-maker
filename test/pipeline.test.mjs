// Native ffmpeg se pipeline.js ka test:  node test/pipeline.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildVideo, planParts, planFrames } from "../www/pipeline.js";

const sh = (args, cwd) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { cwd });
  if (r.status !== 0) throw new Error(r.stderr.toString());
};
const probe = (file) => {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,duration", "-of", "json", file]);
  return JSON.parse(r.stdout.toString()).streams;
};

const work = mkdtempSync(join(tmpdir(), "vm-"));
const fsdir = join(work, "fs"); // ffmpeg ka "virtual" folder
spawnSync("mkdir", ["-p", fsdir]);
const ff = {
  write: async (n, b) => writeFileSync(join(fsdir, n), b),
  exec: async (args) => {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { cwd: fsdir });
    if (r.status !== 0) console.error(r.stderr.toString());
    return r.status;
  },
  read: async (n) => new Uint8Array(readFileSync(join(fsdir, n))),
  del: async (n) => rmSync(join(fsdir, n), { force: true }),
};

// sample inputs
const colors = ["red", "green", "blue", "orange", "purple", "teal"];
const prep = (i, sw, sh_) => {
  const f = join(work, `src_${i}_${sw}.jpg`);
  sh(["-y", "-f", "lavfi", "-i", `testsrc2=s=${sw}x${sh_}:d=1,drawbox=x=0:y=0:w=iw:h=ih/3:color=${colors[i % 6]}@0.6:t=fill`, "-frames:v", "1", f]);
  return new Uint8Array(readFileSync(f));
};
sh(["-y", "-f", "lavfi", "-i", "sine=f=440:d=20", "-c:a", "aac", join(work, "voice.m4a")]);
sh(["-y", "-f", "lavfi", "-i", "sine=f=220:d=5", "-c:a", "libmp3lame", join(work, "music.mp3")]);
const voiceBytes = new Uint8Array(readFileSync(join(work, "voice.m4a")));
const musicBytes = new Uint8Array(readFileSync(join(work, "music.mp3")));

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };

// unit: planning
const fr = planFrames(5, 10, { totalSec: 20 });
ok(fr.reduce((a, b) => a + b) === 200, "planFrames total = 20s*10fps");
ok(JSON.stringify(planParts([100,100,100,100,100], 10, 0)) === "[[0,5]]", "planParts single");
ok(planParts([100,100,100,100,100], 10, 0.35).length === 2, "planParts splits (~21s parts)");

async function scenario(name, { n, w, h, fps, zoom, voice, music, partMinutes, perImageSec, matchVoice }) {
  const got = [];
  const res = await buildVideo({
    ff, count: n,
    getImage: async (i) => prep(i, Math.round(w * (zoom ? 1.5 : 1) / 2) * 2, Math.round(h * (zoom ? 1.5 : 1) / 2) * 2),
    voice: voice ? { ext: "m4a", bytes: voiceBytes, duration: 20 } : null,
    music: music ? { ext: "mp3", bytes: musicBytes } : null,
    opts: { w, h, fps, zoom, fadeSec: 0.4, perImageSec, matchVoice, partMinutes, voiceVol: 1, musicVol: 0.15 },
    onPart: async (p) => { const f = join(work, `${name}_${p.index}.mp4`); writeFileSync(f, p.bytes); got.push({ f, p }); },
  });
  console.log(`-- ${name}: ${res.parts} part(s), ${res.seconds}s`);
  return got;
}

// 1) voice match + zoom + music, ek file
let r = await scenario("match", { n: 5, w: 640, h: 360, fps: 15, zoom: true, voice: true, music: true, partMinutes: 0, matchVoice: true, perImageSec: 3 });
let s = probe(r[0].f);
const v = s.find((x) => x.codec_type === "video"), a = s.find((x) => x.codec_type === "audio");
ok(r.length === 1, "match: 1 file");
ok(v && v.width === 640 && v.height === 360, "match: 640x360");
ok(a && Math.abs(parseFloat(a.duration) - 20) < 0.3, `match: audio ~20s (${a?.duration})`);
ok(v && Math.abs(parseFloat(v.duration) - 20) < 0.3, `match: video ~20s (${v?.duration})`);

// zoom sach mein chal raha hai? ek hi image ke andar do frames alag hon
sh(["-y", "-ss", "0.5", "-i", r[0].f, "-frames:v", "1", join(work, "f1.png")]);
sh(["-y", "-ss", "3.0", "-i", r[0].f, "-frames:v", "1", join(work, "f2.png")]);
ok(readFileSync(join(work, "f1.png")).compare(readFileSync(join(work, "f2.png"))) !== 0, "match: frames alag (zoom/fade)");

// 2) fixed seconds, no audio, no zoom
r = await scenario("plain", { n: 4, w: 480, h: 854, fps: 10, zoom: false, voice: false, music: false, partMinutes: 0, matchVoice: false, perImageSec: 2.5 });
s = probe(r[0].f);
ok(!s.find((x) => x.codec_type === "audio"), "plain: audio nahi");
ok(Math.abs(parseFloat(s.find((x) => x.codec_type === "video").duration) - 10) < 0.3, "plain: ~10s");
ok(s.find((x) => x.codec_type === "video").height === 854, "plain: portrait 480x854");

// 3) parts: voice+music, 12s ke hisse
r = await scenario("parts", { n: 6, w: 640, h: 360, fps: 15, zoom: true, voice: true, music: true, partMinutes: 0.2, matchVoice: true, perImageSec: 3 });
ok(r.length >= 2, `parts: ${r.length} files`);
const total = r.reduce((acc, x) => acc + parseFloat(probe(x.f).find((y) => y.codec_type === "audio").duration), 0);
ok(Math.abs(total - 20) < 0.8, `parts: audio total ~20s (${total.toFixed(2)})`);
ok(r.every((x) => probe(x.f).some((y) => y.codec_type === "video")), "parts: har file mein video");

// 4) music only
r = await scenario("musiconly", { n: 3, w: 640, h: 360, fps: 10, zoom: false, voice: false, music: true, partMinutes: 0, matchVoice: false, perImageSec: 4 });
s = probe(r[0].f);
ok(Math.abs(parseFloat(s.find((x) => x.codec_type === "audio").duration) - 12) < 0.3, "musiconly: audio ~12s (music loop)");

console.log(failed ? `\n${failed} test FAIL` : "\nSab test pass");
console.log("Output folder:", work);
process.exit(failed ? 1 : 0);
