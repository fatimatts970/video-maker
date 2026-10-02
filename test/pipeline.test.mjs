// Native ffmpeg se pipeline.js aur captions.js ka test:  node test/pipeline.test.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildVideo, planParts, planFrames, snapBoundaries, detectPauses, planMotions } from "../www/pipeline.js";
import { buildCaptionItems, splitLines, isRTL } from "../www/captions.js";

const sh = (args, cwd) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { cwd });
  if (r.status !== 0) throw new Error(r.stderr.toString());
};
const probe = (file) =>
  JSON.parse(
    spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,duration", "-of", "json", file]).stdout.toString()
  ).streams;
const pixel = (file, t, x, y) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `crop=1:1:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"]);
  return [...r.stdout];
};

const work = mkdtempSync(join(tmpdir(), "vm-"));
const fsdir = join(work, "fs");
spawnSync("mkdir", ["-p", fsdir]);
let logger = null;
const ff = {
  write: async (n, b) => writeFileSync(join(fsdir, n), b),
  exec: async (args) => {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "info", ...args], { cwd: fsdir });
    if (logger) logger(r.stderr.toString());
    else if (r.status !== 0) console.error(r.stderr.toString().split("\n").slice(-12).join("\n"));
    return r.status;
  },
  read: async (n) => new Uint8Array(readFileSync(join(fsdir, n))),
  del: async (n) => rmSync(join(fsdir, n), { force: true }),
  logTo: (fn) => (logger = fn),
};

const colors = ["red", "green", "blue", "orange", "purple", "teal"];
const prep = (i, sw, sh_) => {
  const f = join(work, `src_${i}_${sw}.jpg`);
  sh(["-y", "-f", "lavfi", "-i", `testsrc2=s=${sw}x${sh_}:d=1,drawbox=x=0:y=0:w=iw:h=ih/3:color=${colors[i % 6]}@0.6:t=fill`, "-frames:v", "1", f]);
  return new Uint8Array(readFileSync(f));
};
const capPng = async (it) => {
  const f = join(work, "cap.png");
  sh(["-y", "-f", "lavfi", "-i", "color=c=red:s=440x50,format=rgba,pad=640:360:100:280:color=0x00000000", "-frames:v", "1", f]);
  return new Uint8Array(readFileSync(f));
};
// voice: 4s tone + 1s khamoshi, 20s
sh(["-y", "-f", "lavfi", "-i", "aevalsrc=if(lt(mod(t\\,5)\\,4)\\,0.5*sin(2*PI*440*t)\\,0):d=20:s=44100", "-c:a", "aac", join(work, "voice.m4a")]);
sh(["-y", "-f", "lavfi", "-i", "sine=f=220:d=5", "-c:a", "libmp3lame", join(work, "music.mp3")]);
const voiceBytes = new Uint8Array(readFileSync(join(work, "voice.m4a")));
const musicBytes = new Uint8Array(readFileSync(join(work, "music.mp3")));

let failed = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failed++; };

// ---- unit ----
ok(planFrames(5, 10, { totalSec: 20 }).reduce((a, b) => a + b) === 200, "planFrames total");
ok(JSON.stringify(planParts([100, 100, 100, 100, 100], 10, 0)) === "[[0,5]]", "planParts single");
ok(planParts([100, 100, 100, 100, 100], 10, 0.35).length === 2, "planParts split");
const sb = snapBoundaries(4, 20, [4.6, 10.2, 14.9], 1.5, 1);
ok(sb.length === 5 && sb[1] === 4.6 && sb[2] === 10.2 && sb[3] === 14.9, `snapBoundaries ${sb}`);
ok(splitLines("Pehli line. Doosri line!\nTeesri").length === 3, "splitLines");
ok(isRTL("یہ اردو ہے") && !isRTL("hello"), "isRTL");
const items = buildCaptionItems({ script: "Ek dinosaur tha. Wo bohat bara tha aur taqatwar", total: 10, anchors: [3.2], mode: "line", perChunk: 3 });
ok(items.length >= 3 && items[0].start === 0 && Math.abs(items.at(-1).end - 10) < 0.2, `captions line items=${items.length}`);
const wItems = buildCaptionItems({ script: "Ek do teen chaar", total: 4, mode: "word", perChunk: 2 });
ok(wItems.length === 4 && wItems[1].active === 1, "captions word mode");

// ---- pauses ----
const pauses = (await (async () => { await ff.write("voice.m4a", voiceBytes); return detectPauses(ff, "voice.m4a"); })());
ok(pauses.length >= 3 && pauses.every((p, i) => Math.abs(p - (4.5 + 5 * i)) < 0.4), `detectPauses ${pauses.map((p) => p.toFixed(1))}`);

async function scenario(name, { n, w, h, fps, voice, music, partMinutes, perImageSec, matchVoice, caps, ...rest }) {
  const got = [];
  const zoom = (rest.motion ?? 'auto') !== 'none';
  const res = await buildVideo({
    ff, count: n,
    getImage: async (i) => prep(i, Math.round((w * (zoom || rest.punch || rest.shake ? 1.5 : 1)) / 2) * 2, Math.round((h * (zoom || rest.punch || rest.shake ? 1.5 : 1)) / 2) * 2),
    voice: voice ? { ext: "m4a", bytes: voiceBytes, duration: 20 } : null,
    music: music ? { ext: "mp3", bytes: musicBytes } : null,
    captionItems: caps ? [{ start: 1, end: 3 }, { start: 5, end: 7 }] : [],
    getCaption: capPng,
    opts: { w, h, fps, perImageSec, matchVoice, partMinutes, transSec: 0.4, ...rest },
    onPart: async (p) => { const f = join(work, `${name}_${p.index}.mp4`); writeFileSync(f, p.bytes); got.push(f); },
  });
  console.log(`-- ${name}: ${res.parts} part(s), ${res.seconds}s`);
  return got;
}
const dur0 = 0;
const dur = (f, t) => parseFloat(probe(f).find((x) => x.codec_type === t)?.duration);

// 1) sab kuch: voice+music+duck+sfx+punch+shake+grade+flash+captions+snap
let r = await scenario("full", { n: 5, w: 640, h: 360, fps: 15, voice: true, music: true, partMinutes: 0, matchVoice: true, perImageSec: 3,
  motion: "auto", punch: true, shake: true, look: "cine", vignette: true, grain: true, bars: false, transition: "flash", sfx: true, duck: true, snap: true, caps: true });
ok(r.length === 1, "full: 1 file");
ok(Math.abs(dur(r[0], "audio") - 20) < 0.4 && Math.abs(dur(r[0], "video") - 20) < 0.4, `full: 20s a=${dur(r[0], "audio")} v=${dur(r[0], "video")}`);
const px = pixel(r[0], 2.0, 320, 305); // caption box (lal) 1-3s ke beech
ok(px[0] > 200 && px[1] < 80 && px[2] < 80, `full: caption nazar aaya rgb=${px}`);
const px2 = pixel(r[0], 4.0, 320, 305); // 3-5s: caption nahi
ok(!(px2[0] > 200 && px2[1] < 80 && px2[2] < 80), `full: caption gayab rgb=${px2}`);

// 2) plain: fixed seconds, no audio, no effects, cut
r = await scenario("plain", { n: 4, w: 480, h: 854, fps: 10, partMinutes: 0, matchVoice: false, perImageSec: 2.5, motion: "none", transition: "cut" });
ok(!probe(r[0]).find((x) => x.codec_type === "audio") && Math.abs(dur(r[0], "video") - 10) < 0.3, "plain: ~10s, audio nahi");
ok(probe(r[0]).find((x) => x.codec_type === "video").height === 854, "plain: portrait");

// 3) parts + sfx without music
r = await scenario("parts", { n: 6, w: 640, h: 360, fps: 15, voice: true, music: false, partMinutes: 0.2, matchVoice: true, perImageSec: 3, sfx: true });
const total = r.reduce((s, f) => s + dur(f, "audio"), 0);
ok(r.length >= 2 && Math.abs(total - 20) < 0.8, `parts: ${r.length} files, audio total ${total.toFixed(2)}`);

// 4) music only (loop) + duck off
r = await scenario("musiconly", { n: 3, w: 640, h: 360, fps: 10, music: true, partMinutes: 0, matchVoice: false, perImageSec: 4, motion: "none", duck: false });
ok(Math.abs(dur(r[0], "audio") - 12) < 0.3, "musiconly: ~12s");

// 5) sfx only (na voice na music)
r = await scenario("sfxonly", { n: 3, w: 640, h: 360, fps: 10, partMinutes: 0, matchVoice: false, perImageSec: 3, motion: "none", transition: "slide", sfx: true });
ok(Math.abs(dur(r[0], "audio") - 9) < 0.3, "sfxonly: audio ~9s");

// 6) auto xfade + har look + zoom/pan, caption, voice
for (const look of ["vivid", "warm", "bw"]) {
  r = await scenario("auto_" + look, { n: 6, w: 640, h: 360, fps: 12, voice: true, partMinutes: 0, matchVoice: true, perImageSec: 3,
    motion: "auto", look, bars: true, transition: "auto", sfx: true, caps: true, seed: 5 });
  ok(Math.abs(dur(r[0], "video") - 20) < 0.5 && Math.abs(dur(r[0], "audio") - 20) < 0.5, `auto_${look}: 20s v=${dur(r[0], "video")}`);
}
// 7) wipe + parts + portrait
r = await scenario("wipe_parts", { n: 8, w: 480, h: 854, fps: 10, voice: true, partMinutes: 0.2, matchVoice: true, perImageSec: 3, motion: "alt", transition: "wipe" });
ok(r.length >= 2 && Math.abs(r.reduce((s, f) => s + dur(f, "video"), 0) - 20) < 1, `wipe_parts: ${r.length} files`);
ok(planMotions(6, "auto", 3).every((m, i, a) => !i || m.name !== a[i - 1].name), "planMotions koi repeat nahi");
console.log(failed ? `\n${failed} test FAIL` : "\nSab test pass");
console.log("Output folder:", work);
process.exit(failed ? 1 : 0);
