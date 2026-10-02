// pipeline.js — images + voiceover se video banane ka logic (DOM se azaad).
// `ff` adapter: write(name, bytes) | exec(args)->code | read(name) | del(name) | logTo(fn|null)

export const SIZES = {
  landscape720: { w: 1280, h: 720, label: "Landscape 720p" },
  landscape480: { w: 854, h: 480, label: "Landscape 480p (tez)" },
  portrait720: { w: 720, h: 1280, label: "Portrait 720p" },
  portrait480: { w: 480, h: 854, label: "Portrait 480p (tez)" },
};

export const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const num = (x) => Number(x).toFixed(3);
const n4 = (x) => Number(Number(x).toFixed(4));

// ---------- seeded random ----------
const lcg = (seed) => {
  let x = (Math.floor(seed) >>> 0) || 1;
  return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
};

// ---------- timing plan ----------

// Cut points ko pauses/jumlon ke qareeb "snap" karna taake cut awaaz ke beech na kate.
export function snapBoundaries(count, total, anchors, tol, minDur = 1) {
  const b = [0];
  for (let k = 1; k < count; k++) {
    let t = (k * total) / count;
    if (anchors && anchors.length) {
      let best = null;
      for (const a of anchors) if (Math.abs(a - t) <= tol && (best === null || Math.abs(a - t) < Math.abs(best - t))) best = a;
      if (best !== null) t = best;
    }
    const lo = b[k - 1] + minDur;
    const hi = total - (count - k) * minDur;
    b.push(Math.min(Math.max(t, lo), Math.max(lo, hi)));
  }
  b.push(total);
  return b;
}

export function framesFromBoundaries(bounds, fps) {
  const out = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    out.push(Math.max(2, Math.round(bounds[i + 1] * fps) - Math.round(bounds[i] * fps)));
  }
  return out;
}

export function planFrames(count, fps, { perImageSec, totalSec, anchors, snapTol }) {
  if (totalSec) {
    const per = totalSec / count;
    return framesFromBoundaries(snapBoundaries(count, totalSec, anchors, snapTol ?? per * 0.35, Math.min(1, per * 0.5)), fps);
  }
  return Array.from({ length: count }, () => Math.max(2, Math.round(perImageSec * fps)));
}

export function planParts(frames, fps, partMinutes) {
  const n = frames.length;
  if (!partMinutes || partMinutes <= 0) return [[0, n]];
  const limit = partMinutes * 60 * fps;
  const parts = [];
  let start = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += frames[i];
    if (acc >= limit) {
      parts.push([start, i + 1]);
      start = i + 1;
      acc = 0;
    }
  }
  if (start < n) {
    if (parts.length && acc < limit * 0.25) parts[parts.length - 1][1] = n;
    else parts.push([start, n]);
  }
  return parts;
}

// ---------- auto director: motion + transitions ----------

// [zoom0, zoom1, fx0, fx1, fy0, fy1]  (fx/fy: nazar ka markaz 0..1 image par)
export const MOTIONS = [
  { name: "zoom-in", v: [1.0, 1.2, 0.5, 0.5, 0.5, 0.5] },
  { name: "zoom-out", v: [1.2, 1.0, 0.5, 0.5, 0.5, 0.5] },
  { name: "pan-right", v: [1.18, 1.18, 0.0, 1.0, 0.5, 0.5] },
  { name: "pan-left", v: [1.18, 1.18, 1.0, 0.0, 0.5, 0.5] },
  { name: "tilt-up", v: [1.18, 1.18, 0.5, 0.5, 1.0, 0.0] },
  { name: "tilt-down", v: [1.18, 1.18, 0.5, 0.5, 0.0, 1.0] },
  { name: "drift-in-a", v: [1.0, 1.22, 0.5, 0.25, 0.5, 0.3] },
  { name: "drift-in-b", v: [1.0, 1.22, 0.5, 0.75, 0.5, 0.7] },
  { name: "corner-out", v: [1.22, 1.02, 0.3, 0.5, 0.3, 0.5] },
];

export function planMotions(n, mode, seed = 1, amt = 1) {
  const rnd = lcg(seed * 7919 + 17);
  const out = [];
  let prev = -1;
  for (let i = 0; i < n; i++) {
    let idx;
    if (mode === "none") { out.push(null); continue; }
    if (mode === "zoomin") idx = 0;
    else if (mode === "alt") idx = i % 2;
    else {
      do idx = Math.floor(rnd() * MOTIONS.length); while (idx === prev && MOTIONS.length > 1);
    }
    prev = idx;
    const v = MOTIONS[idx].v.slice();
    v[0] = 1 + (v[0] - 1) * amt;
    v[1] = 1 + (v[1] - 1) * amt;
    out.push({ name: MOTIONS[idx].name, v });
  }
  return out;
}

export const XFADE_SETS = {
  auto: ["fade", "slideleft", "wipeleft", "circleopen", "smoothright", "dissolve", "slideup", "radial", "horzopen", "slideright", "diagbl", "wiperight"],
  crossfade: ["fade"],
  slide: ["slideleft", "slideright", "slideup", "slidedown"],
  wipe: ["wipeleft", "wiperight", "wipeup", "wipedown"],
};
const SOFT = new Set(["fade", "dissolve", "fadeblack", "fadewhite", "distance"]);

export function isXfadeMode(t) {
  return t in XFADE_SETS;
}

// har boundary ke liye { L: frames, type }
export function planTransitions(frames, fps, o, parts, seed = 1) {
  const n = frames.length;
  const out = Array.from({ length: Math.max(0, n - 1) }, () => ({ L: 0, type: null }));
  if (!isXfadeMode(o.transition)) return out;
  const set = XFADE_SETS[o.transition];
  const rnd = lcg(seed * 104729 + 3);
  const want = Math.max(2, Math.round((o.transSec ?? 0.5) * fps));
  let prev = -1;
  for (let i = 0; i < n - 1; i++) {
    let idx;
    if (set.length === 1) idx = 0;
    else if (o.transition === "auto") {
      do idx = Math.floor(rnd() * set.length); while (idx === prev);
    } else idx = i % set.length;
    prev = idx;
    const L = Math.min(want, Math.floor(frames[i] * 0.4), Math.floor(frames[i + 1] * 0.4));
    out[i] = L >= 2 ? { L, type: set[idx] } : { L: 0, type: null };
  }
  // part ki hadd par transition nahi (file alag hai)
  for (const [a] of parts) if (a > 0) out[a - 1] = { L: 0, type: null };
  return out;
}

// ---------- audio analysis ----------
export async function detectPauses(ff, voiceName, { noise = -32, minSec = 0.3 } = {}) {
  const lines = [];
  ff.logTo && ff.logTo((m) => lines.push(m));
  try {
    await ff.exec(["-i", voiceName, "-af", `silencedetect=noise=${noise}dB:d=${minSec}`, "-f", "null", "-"]);
  } finally {
    ff.logTo && ff.logTo(null);
  }
  const text = lines.join("\n");
  const starts = [...text.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Math.max(0, parseFloat(m[1])));
  const ends = [...text.matchAll(/silence_end:\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
  const mids = [];
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) mids.push((starts[i] + ends[i]) / 2);
  return mids;
}

// ---------- filter builders ----------

const LOOKS = {
  none: "",
  vivid: "eq=contrast=1.08:saturation=1.25",
  cine: "eq=contrast=1.1:saturation=1.1,colorbalance=rs=-0.06:gs=-0.01:bs=0.08:rh=0.07:gh=0.02:bh=-0.06",
  warm: "eq=contrast=1.05:saturation=1.1,colorbalance=rs=0.08:bs=-0.08:rm=0.05:bm=-0.05",
  bw: "hue=s=0,eq=contrast=1.18:brightness=0.02",
};

function lookChain(o, w, h) {
  const c = [];
  if (LOOKS[o.look]) c.push(LOOKS[o.look]);
  if (o.vignette) c.push("vignette=a=PI/5");
  if (o.grain) c.push("noise=alls=7:allf=t");
  if (o.bars) {
    const bh = even(h * 0.09);
    c.push(`drawbox=x=0:y=0:w=iw:h=${bh}:color=black@1:t=fill`, `drawbox=x=0:y=ih-${bh}:w=iw:h=${bh}:color=black@1:t=fill`);
  }
  return c;
}

// ek image ke liye motion filter. off = is clip ka pehla motion-frame (negative bhi ho sakta hai)
function motionFilter({ m, F, off, fps, w, h, o }) {
  const useZoom = m || o.punch || o.shake;
  if (!useZoom) return `scale=${w}:${h},format=yuv420p`;
  const v = m ? m.v : [1, 1, 0.5, 0.5, 0.5, 0.5];
  let [z0, z1, fx0, fx1, fy0, fy1] = v;
  if (o.shake) { z0 = Math.max(z0, 1.06); z1 = Math.max(z1, 1.06); }
  const T = Math.max(1, F - 1);
  const p = `clip((on+${off})/${T},0,1)`;
  const e = `(${p}*${p}*(3-2*${p}))`;
  const t = `(on+${off})`;
  let z = `${n4(z0)}+(${n4(z1 - z0)})*${e}`;
  if (o.punch) z += `+0.10*max(0,1-max(0,${t})/${Math.max(2, Math.round(0.35 * fps))})`;
  let x = `(iw-iw/zoom)*(${n4(fx0)}+(${n4(fx1 - fx0)})*${e})`;
  let y = `(ih-ih/zoom)*(${n4(fy0)}+(${n4(fy1 - fy0)})*${e})`;
  if (o.shake) {
    const N = Math.max(3, Math.round(0.45 * fps));
    x += `+(iw*0.012)*sin(${t}*1.9)*max(0,1-max(0,${t})/${N})`;
    y += `+(ih*0.012)*cos(${t}*2.3)*max(0,1-max(0,${t})/${N})`;
  }
  return `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${w}x${h}:fps=${fps},format=yuv420p`;
}

// ek clip (body ya transition) ke args
function clipArgs({ clip, fps, w, h, o, caps, totalFrames, out }) {
  const args = ["-y"];
  const imgIn = (f) => args.push("-loop", "1", "-framerate", String(fps), "-i", f);
  let g;
  let nImg;
  if (clip.kind === "body") {
    imgIn(`img_${clip.i}.jpg`);
    nImg = 1;
    g = `[0:v]${motionFilter({ m: clip.m, F: clip.F, off: clip.m0, fps, w, h, o })}`;
  } else {
    imgIn(`img_${clip.i}.jpg`);
    imgIn(`img_${clip.i + 1}.jpg`);
    nImg = 2;
    g =
      `[0:v]${motionFilter({ m: clip.m, F: clip.F, off: clip.m0, fps, w, h, o })}[xa];` +
      `[1:v]${motionFilter({ m: clip.m2, F: clip.F2, off: clip.m02, fps, w, h, o })}[xb];` +
      `[xa][xb]xfade=transition=${clip.type}:duration=${num(clip.frames / fps)}:offset=0`;
  }
  const look = lookChain(o, w, h);
  if (look.length) g += "," + look.join(",");
  g += "[b0]";
  let last = "b0";
  caps.forEach((c, k) => {
    args.push("-loop", "1", "-framerate", "2", "-i", c.file);
    const out2 = `b${k + 1}`;
    g += `;[${last}][${nImg + k}:v]overlay=0:0:enable='between(t,${num(c.a)},${num(c.b)})'[${out2}]`;
    last = out2;
  });

  // fade: shuru/aakhir ki video + dip-to-black / flash wale modes
  const dur = clip.frames / fps;
  const tail = [];
  const isStart = clip.g0 === 0;
  const isEnd = clip.g0 + clip.frames >= totalFrames;
  if (o.introOutro !== false) {
    if (isStart) tail.push(`fade=t=in:st=0:d=${num(Math.min(0.6, dur / 2))}`);
    if (isEnd) tail.push(`fade=t=out:st=${num(Math.max(0, dur - Math.min(0.9, dur / 2)))}:d=${num(Math.min(0.9, dur / 2))}`);
  }
  if (clip.kind === "body" && o.transition === "fade") {
    const f = Math.max(0, Math.min(o.transSec ?? 0.5, dur / 3));
    if (f > 0) {
      if (clip.atSceneStart && !isStart) tail.push(`fade=t=in:st=0:d=${num(f)}`);
      if (clip.atSceneEnd && !isEnd) tail.push(`fade=t=out:st=${num(dur - f)}:d=${num(f)}`);
    }
  } else if (clip.kind === "body" && o.transition === "flash" && clip.atSceneStart && !isStart) {
    tail.push("fade=t=in:st=0:d=0.12:color=white");
  }
  tail.push("format=yuv420p");
  g += `;[${last}]${tail.join(",")}[vout]`;

  args.push(
    "-filter_complex", g,
    "-map", "[vout]",
    "-frames:v", String(clip.frames),
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "27",
    "-pix_fmt", "yuv420p",
    "-an",
    out
  );
  return args;
}

function muxArgs({ video, out, voice, music, sfxFiles, cuts, start, dur, o }) {
  const args = ["-y", "-i", video];
  let idx = 1;
  const I = {};
  if (voice) { args.push("-ss", num(start), "-i", voice); I.v = idx++; }
  if (music) { args.push("-stream_loop", "-1", "-i", music); I.m = idx++; }
  const kinds = [];
  for (const kind of ["whoosh", "hit"]) {
    const list = cuts.filter((c) => c.kind === kind).slice(0, 120);
    if (list.length && sfxFiles[kind]) {
      args.push("-i", sfxFiles[kind]);
      kinds.push({ kind, list, idx: idx++ });
    }
  }
  if (I.v === undefined && I.m === undefined && !kinds.length) {
    return [...args, "-c", "copy", "-movflags", "+faststart", out];
  }

  const f = [];
  const mix = [];
  const duck = !!(o.duck && I.v !== undefined && I.m !== undefined);
  if (I.v !== undefined) {
    const clean = o.voiceClean ? "dynaudnorm=f=250:g=7," : "";
    f.push(`[${I.v}:a]${clean}apad,volume=${o.voiceVol}${duck ? ",asplit=2[vo][vk]" : "[vo]"}`);
    mix.push("vo");
  }
  if (I.m !== undefined) {
    if (duck) {
      f.push(`[${I.m}:a]volume=${o.musicVol}[mu0]`);
      f.push(`[mu0][vk]sidechaincompress=threshold=0.03:ratio=10:attack=30:release=700[mu]`);
    } else {
      f.push(`[${I.m}:a]volume=${o.musicVol}[mu]`);
    }
    mix.push("mu");
  }
  for (const { kind, list, idx: ii } of kinds) {
    const n = list.length;
    if (n === 1) f.push(`[${ii}:a]anull[${kind}0]`);
    else f.push(`[${ii}:a]asplit=${n}${list.map((_, k) => `[${kind}${k}]`).join("")}`);
    list.forEach((c, k) => {
      f.push(`[${kind}${k}]adelay=delays=${Math.max(0, Math.round(c.t * 1000))}:all=1,volume=${o.sfxVol}[${kind}d${k}]`);
    });
    if (n === 1) f.push(`[${kind}d0]anull[sx_${kind}]`);
    else f.push(`${list.map((_, k) => `[${kind}d${k}]`).join("")}amix=inputs=${n}:normalize=0[sx_${kind}]`);
    mix.push(`sx_${kind}`);
  }
  if (mix.length === 1) f.push(`[${mix[0]}]apad,alimiter=limit=0.97[a]`);
  else f.push(`${mix.map((m) => `[${m}]`).join("")}amix=inputs=${mix.length}:duration=first:normalize=0,alimiter=limit=0.97[a]`);
  return [
    ...args,
    "-filter_complex", f.join(";"),
    "-map", "0:v:0",
    "-map", "[a]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "160k",
    "-t", num(dur),
    "-movflags", "+faststart",
    out,
  ];
}

/**
 * opts: { w,h,fps, motion:'auto'|'zoomin'|'alt'|'none', motionAmt, punch, shake,
 *         look, vignette, grain, bars,
 *         transition:'auto'|'crossfade'|'slide'|'wipe'|'fade'|'flash'|'cut', transSec,
 *         seed, perImageSec, matchVoice, snap, partMinutes,
 *         voiceVol, musicVol, voiceClean, sfx, sfxVol, duck, introOutro }
 * captionItems: [{start,end,...}] (timeline seconds), getCaption(item)->Promise<Uint8Array PNG>
 */
export async function buildVideo({
  ff,
  count,
  getImage,
  voice,
  music,
  opts,
  captionItems = [],
  getCaption,
  onProgress = () => {},
  onPart = async () => {},
  isCancelled = () => false,
}) {
  const o = {
    motion: "auto", motionAmt: 1, punch: false, shake: false,
    look: "none", vignette: false, grain: false, bars: false,
    transition: "crossfade", transSec: 0.5, seed: 1,
    voiceVol: 1, musicVol: 0.15, voiceClean: true, sfx: false, sfxVol: 0.5, duck: true, snap: true, introOutro: true,
    ...opts,
  };
  const { w, h, fps } = o;
  if (!count) throw new Error("Koi image nahi chuni.");

  const check = () => { if (isCancelled()) throw new Error("Cancel kar diya gaya."); };
  const run = async (args, what) => {
    check();
    const code = await ff.exec(args);
    if (code !== 0) throw new Error(`ffmpeg fail (${what}), code ${code}`);
  };

  const voiceName = voice ? `voice.${voice.ext}` : null;
  const musicName = music ? `music.${music.ext}` : null;
  if (voice) await ff.write(voiceName, voice.bytes);
  if (music) await ff.write(musicName, music.bytes);

  let anchors = [];
  if (voice && o.matchVoice && o.snap) {
    onProgress({ stage: "analyse", fraction: 0, text: "Awaaz ke pauses dhoond raha hoon…" });
    try { anchors = voice.pauses || (await detectPauses(ff, voiceName)); } catch { anchors = []; }
  }

  const totalSec = voice && o.matchVoice && voice.duration ? voice.duration : null;
  const frames = planFrames(count, fps, { perImageSec: o.perImageSec, totalSec, anchors });
  const parts = planParts(frames, fps, o.partMinutes);
  const G = [0];
  for (let i = 0; i < count; i++) G.push(G[i] + frames[i]);
  const totalFrames = G[count];

  const motions = planMotions(count, o.motion, o.seed, o.motionAmt);
  const trans = planTransitions(frames, fps, o, parts, o.seed);

  // sound effects
  const sfxFiles = {};
  if (o.sfx) {
    await run(["-y", "-f", "lavfi", "-i", "anoisesrc=d=0.5:c=pink:a=0.5:r=44100",
      "-af", "highpass=f=300,lowpass=f=5000,afade=t=in:d=0.2,afade=t=out:st=0.2:d=0.3,volume=3", "whoosh.wav"], "sfx");
    sfxFiles.whoosh = "whoosh.wav";
    await run(["-y", "-f", "lavfi", "-i", "aevalsrc=0.95*sin(2*PI*(50+130*exp(-t*14))*t)*exp(-t*5):d=0.8:s=44100",
      "hit.wav"], "sfx2");
    sfxFiles.hit = "hit.wav";
  }

  const have = new Set();
  const ensureImg = async (i) => {
    if (have.has(i)) return;
    await ff.write(`img_${i}.jpg`, await getImage(i));
    have.add(i);
  };
  const dropImg = async (i) => {
    if (!have.has(i)) return;
    have.delete(i);
    await ff.del(`img_${i}.jpg`);
  };

  const capsFor = async (g0, nFrames, tag) => {
    const out = [];
    if (!captionItems.length || !getCaption) return out;
    const s0 = g0 / fps;
    const s1 = (g0 + nFrames) / fps;
    let k = 0;
    for (const it of captionItems) {
      if (it.end <= s0 || it.start >= s1) continue;
      const file = `cap_${tag}_${k++}.png`;
      await ff.write(file, await getCaption(it));
      out.push({ file, a: Math.max(it.start, s0) - s0, b: Math.min(it.end, s1) - s0 });
    }
    return out;
  };

  let clipsDone = 0;
  const clipsTotal = count + trans.filter((t) => t.L > 0).length;

  for (let p = 0; p < parts.length; p++) {
    const [a, b] = parts[p];
    const files = [];
    const cuts = [];
    let cn = 0;

    for (let i = a; i < b; i++) {
      await ensureImg(i);
      const Lprev = i > a ? trans[i - 1].L : 0;
      const Lnext = i < b - 1 ? trans[i].L : 0;
      const m0 = Math.ceil(Lprev / 2);
      const m1 = frames[i] - Math.floor(Lnext / 2);
      const bodyFrames = m1 - m0;
      const prog = (text) => onProgress({ stage: "clip", part: p + 1, parts: parts.length, fraction: clipsDone / clipsTotal, text });

      if (bodyFrames > 0) {
        prog(`Part ${p + 1}/${parts.length} · image ${i + 1}/${count}`);
        const g0 = G[i] + m0;
        const caps = await capsFor(g0, bodyFrames, `${i}b`);
        const file = `clip_${cn++}.mp4`;
        await run(
          clipArgs({
            clip: { kind: "body", i, m: motions[i], F: frames[i], m0, frames: bodyFrames, g0,
              atSceneStart: m0 === 0, atSceneEnd: Lnext === 0 },
            fps, w, h, o, caps, totalFrames, out: file,
          }),
          `image ${i + 1}`
        );
        for (const c of caps) await ff.del(c.file);
        files.push(file);
      }
      clipsDone++;

      // boundary effects
      if (i < b - 1) {
        const T = trans[i];
        const tc = (G[i + 1] - G[a]) / fps; // part ke andar boundary ka waqt
        if (T.L > 0) {
          await ensureImg(i + 1);
          prog(`Part ${p + 1}/${parts.length} · transition ${i + 1}→${i + 2}`);
          const R = Math.floor(T.L / 2);
          const g0 = G[i + 1] - R;
          const caps = await capsFor(g0, T.L, `${i}t`);
          const file = `clip_${cn++}.mp4`;
          await run(
            clipArgs({
              clip: { kind: "trans", i, type: T.type, frames: T.L, g0,
                m: motions[i], F: frames[i], m0: frames[i] - R,
                m2: motions[i + 1], F2: frames[i + 1], m02: -R },
              fps, w, h, o, caps, totalFrames, out: file,
            }),
            `transition ${i + 1}`
          );
          for (const c of caps) await ff.del(c.file);
          files.push(file);
          clipsDone++;
          if (o.sfx && !SOFT.has(T.type)) cuts.push({ t: tc - 0.12, kind: "whoosh" });
        } else if (o.sfx && (o.transition === "flash" || o.transition === "cut")) {
          cuts.push({ t: tc, kind: "hit" });
        }
      }
      await dropImg(i);
    }
    await dropImg(b);

    onProgress({
      stage: "join", part: p + 1, parts: parts.length, fraction: clipsDone / clipsTotal,
      text: `Part ${p + 1}/${parts.length} · awaaz aur effects laga raha hoon`,
    });
    await ff.write("list.txt", new TextEncoder().encode(files.map((n) => `file '${n}'`).join("\n") + "\n"));
    await run(["-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "pv.mp4"], "join");

    const partFrames = G[b] - G[a];
    const out = `out_${p + 1}.mp4`;
    await run(
      muxArgs({ video: "pv.mp4", out, voice: voiceName, music: musicName, sfxFiles, cuts,
        start: G[a] / fps, dur: partFrames / fps, o }),
      "audio"
    );
    for (const n of files) await ff.del(n);
    await ff.del("pv.mp4");
    await ff.del("list.txt");
    const data = await ff.read(out);
    await onPart({
      index: p + 1, total: parts.length,
      name: parts.length === 1 ? "movie.mp4" : `movie_part${p + 1}.mp4`,
      bytes: data, seconds: partFrames / fps,
    });
    await ff.del(out);
  }
  onProgress({ stage: "done", fraction: 1, text: "Ho gaya" });
  return { parts: parts.length, seconds: totalFrames / fps };
}
