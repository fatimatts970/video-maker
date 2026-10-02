import { buildVideo, SIZES, even, detectPauses } from "./pipeline.js";
import { buildCaptionItems } from "./captions.js";
import { captionPNG, drawCaption, THEMES } from "./render.js";

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const cap = window.Capacitor;
const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

// ---------------------------------------------------------------- settings
const S = {
  preset: "doc",
  motion: "auto", punch: false, shake: false, look: "vivid", vignette: false, grain: false, bars: false,
  sfx: false, duck: true, voiceClean: true,
  transition: "crossfade",
  capMode: "line", capPos: "bottom", capFont: "Poppins", capTheme: "white", capSize: 6.5,
  upper: false, box: false,
  size: "landscape720", fps: "15", partMin: "0",
};

const PRESETS = [
  { id: "doc", name: "Documentary", sub: "Auto camera move, crossfade, saaf captions",
    set: { motion: "auto", punch: false, shake: false, look: "vivid", vignette: true, grain: false, bars: false, sfx: false, duck: true, transition: "crossfade",
      capMode: "line", capPos: "bottom", capFont: "Poppins", capTheme: "white", capSize: 6.5, upper: false, box: false } },
  { id: "reel", name: "Tez reel", sub: "Punch zoom, shake, slide/wipe, whoosh, lafz captions",
    set: { motion: "auto", punch: true, shake: true, look: "vivid", vignette: true, grain: true, bars: false, sfx: true, duck: true, transition: "auto",
      capMode: "word", capPos: "center", capFont: "Poppins", capTheme: "yellow", capSize: 8, upper: true, box: false } },
  { id: "cine", name: "Cinematic", sub: "Lambi fade, rang nikhaar, bina caption",
    set: { motion: "auto", punch: false, shake: false, look: "cine", vignette: true, grain: true, bars: true, sfx: false, duck: true, transition: "crossfade", capMode: "off" } },
  { id: "clean", name: "Saada", sub: "Sirf images aur awaaz",
    set: { motion: "none", punch: false, shake: false, look: "none", vignette: false, grain: false, bars: false, sfx: false, duck: true, transition: "cut", capMode: "off" } },
];

const state = {
  images: [], // { file, url }
  sel: -1,
  voice: null, // { file, ext, duration }
  music: null,
  results: [], // { name, blob, seconds, uri }
  playing: -1,
  cancelled: false,
  running: false,
  ffmpeg: null,
  logFn: null,
};

// ---------------------------------------------------------------- helpers
const fmt = (s) => {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const extOf = (n) => (n.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
const showError = (m) => {
  $("err").hidden = !m;
  $("err").textContent = m || "";
};
window.addEventListener("unhandledrejection", (e) =>
  showError("Error: " + (e.reason && e.reason.message ? e.reason.message : e.reason))
);
const matching = () => !!(state.voice && state.voice.duration && $("matchVoice").checked);
const perImg = () => Number($("perImg").value) || 4;
const totalSeconds = () => (matching() ? state.voice.duration : state.images.length * perImg());
const effZoomScale = () => (S.motion !== "none" || S.punch || S.shake ? 1.5 : 1);

function audioDuration(file) {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : null);
    a.onerror = () => done(null);
    a.src = url;
  });
}

// ---------------------------------------------------------------- fonts
const RANGES = {
  latin: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  arabic: "U+0600-06FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC",
};
async function loadFonts() {
  try {
    const r = await fetch("vendor/fonts/fonts.json");
    if (!r.ok) return;
    const list = await r.json();
    await Promise.all(
      list.map((f) => {
        const face = new FontFace(f.family, `url(vendor/fonts/${f.file})`, {
          weight: String(f.weight),
          unicodeRange: RANGES[f.subset] || RANGES.latin,
        });
        document.fonts.add(face);
        return face.load().catch(() => {});
      })
    );
  } catch {}
}
const ensureFont = (family) =>
  document.fonts ? document.fonts.load(`700 40px "${family}"`, "Abc اردو").catch(() => {}) : Promise.resolve();

// ---------------------------------------------------------------- tabs
function showTab(name, target) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  $("app").classList.toggle("on-home", name === "home");
  window.scrollTo(0, 0);
  if (name === "style") drawPreview();
  if (name === "home") renderHome();
  if (target) {
    const el = document.querySelector(target);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }
}
$$("#tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
$$("[data-go]").forEach((b) =>
  b.addEventListener("click", () => {
    const [tab, target] = b.dataset.go.split(":");
    if (target === "#panel-caption" && S.capMode === "off") { S.capMode = "line"; S.preset = "custom"; syncControls(); }
    showTab(tab, target);
  })
);

function renderHome() {
  const box = $("recent");
  box.innerHTML = "";
  const add = (el) => box.appendChild(el);
  if (state.images.length) {
    const b = document.createElement("button");
    b.className = "rthumb";
    b.type = "button";
    b.innerHTML = `<img alt=""><span></span>`;
    b.querySelector("img").src = state.images[0].url;
    b.querySelector("span").textContent = `${state.images.length} images`;
    b.onclick = () => showTab("studio");
    add(b);
  }
  state.results.forEach((r, i) => {
    const b = document.createElement("button");
    b.className = "rthumb";
    b.type = "button";
    b.innerHTML = `<img alt=""><i class="play"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></i><span></span>`;
    if (state.images[0]) b.querySelector("img").src = state.images[0].url;
    b.querySelector("span").textContent = r.name.replace(".mp4", "");
    b.onclick = () => { renderPlay(); playResult(i); showTab("play"); };
    add(b);
  });
  for (let k = box.children.length; k < 3; k++) {
    const p = document.createElement("div");
    p.className = "rthumb ph";
    add(p);
  }
}

// ---------------------------------------------------------------- images
function renderStrip() {
  const strip = $("strip");
  $$(".frame:not(.add)", strip).forEach((n) => n.remove());
  state.images.forEach((it, i) => {
    const b = document.createElement("button");
    b.className = "frame" + (i === state.sel ? " sel" : "");
    b.type = "button";
    b.setAttribute("aria-label", `Image ${i + 1}`);
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = it.url;
    const no = document.createElement("span");
    no.className = "no";
    no.textContent = i + 1;
    b.append(img, no);
    b.onclick = () => {
      state.sel = state.sel === i ? -1 : i;
      renderStrip();
    };
    strip.appendChild(b);
  });
  const has = state.sel >= 0 && state.sel < state.images.length;
  $("selbar").hidden = !has;
  if (has) $("selInfo").textContent = `Image ${state.sel + 1}/${state.images.length} · ${state.images[state.sel].file.name}`;
  $("imgCount").textContent = state.images.length ? `${state.images.length} tasaveer` : "";
  refreshPreviewImage();
  updateSummary();
  renderHome();
}
function addImages(files) {
  files = [...files].sort((a, b) => collator.compare(a.name, b.name));
  for (const file of files) state.images.push({ file, url: URL.createObjectURL(file) });
  renderStrip();
}
$("imgs").addEventListener("change", (e) => { addImages(e.target.files); e.target.value = ""; });
$("sortName").onclick = () => { state.sel = -1; state.images.sort((a, b) => collator.compare(a.file.name, b.file.name)); renderStrip(); };
$("rev").onclick = () => { state.sel = -1; state.images.reverse(); renderStrip(); };
$("shuf").onclick = () => {
  state.sel = -1;
  for (let i = state.images.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.images[i], state.images[j]] = [state.images[j], state.images[i]];
  }
  renderStrip();
};
$("clearImgs").onclick = () => {
  state.images.forEach((i) => URL.revokeObjectURL(i.url));
  state.images = [];
  state.sel = -1;
  renderStrip();
};
const move = (d) => {
  const i = state.sel, j = i + d;
  if (i < 0 || j < 0 || j >= state.images.length) return;
  [state.images[i], state.images[j]] = [state.images[j], state.images[i]];
  state.sel = j;
  renderStrip();
};
$("mvL").onclick = () => move(-1);
$("mvR").onclick = () => move(1);
$("rm").onclick = () => {
  if (state.sel < 0) return;
  URL.revokeObjectURL(state.images[state.sel].url);
  state.images.splice(state.sel, 1);
  state.sel = -1;
  renderStrip();
};

// ---------------------------------------------------------------- audio
$("voice").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const duration = await audioDuration(file);
  state.voice = { file, ext: extOf(file.name), duration };
  const mb = file.size / 1048576;
  $("voiceInfo").textContent = `${file.name} · ${duration ? fmt(duration) : "lambai maloom nahi"}` + (mb > 150 ? " · file bohat bhari hai, mp3/m4a behtar hai" : "");
  $("voiceInfo").parentElement.classList.add("has");
  updateSummary();
});
$("music").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  state.music = { file, ext: extOf(file.name) };
  $("musicInfo").textContent = file.name;
  $("musicInfo").parentElement.classList.add("has");
});
$("musicVol").addEventListener("input", () => ($("musicVolV").textContent = $("musicVol").value));
$("perImg").addEventListener("input", () => { $("perImgV").textContent = $("perImg").value; updateSummary(); });
["matchVoice", "snap"].forEach((id) => $(id).addEventListener("change", updateSummary));
$("script").addEventListener("input", () => { updateSummary(); drawPreview(); });

function updateSummary() {
  const n = state.images.length;
  $("fixedWrap").hidden = matching();
  if (!n) {
    $("chip").textContent = "Khali project";
    $("summary").textContent = "Pehle images chunein.";
    return;
  }
  const t = totalSeconds();
  const sz = SIZES[S.size];
  $("chip").textContent = `${n} images · ${fmt(t)}`;
  let msg = `${fmt(t)} ki video · ${sz.label}`;
  if (S.capMode !== "off" && !$("script").value.trim()) msg += " · captions ke liye awaaz ka text likhein";
  if (S.capMode !== "off" && $("script").value.trim() && !(state.voice && state.voice.duration)) msg += " · caption timing ke liye voiceover chunein";
  $("summary").textContent = msg;
}

// ---------------------------------------------------------------- style controls
function sample() {
  const txt = $("script").value.trim();
  if (txt) {
    const first = buildCaptionItems({ script: txt, total: 10, mode: S.capMode === "word" ? "word" : "line", perChunk: 3 });
    if (first.length) return first[Math.min(1, first.length - 1)];
  }
  return { words: ["Ek", "bohat", "bara", "dinosaur"].slice(0, 3), active: S.capMode === "word" ? 1 : -1 };
}
let previewImg = null;
function refreshPreviewImage() {
  const first = state.images[0];
  if (!first) { previewImg = null; return; }
  const im = new Image();
  im.onload = () => { previewImg = im; drawPreview(); };
  im.src = first.url;
}
async function drawPreview() {
  const c = $("capPrev");
  if (!c) return;
  const size = SIZES[S.size];
  const W = Math.round(size.w >= size.h ? 640 : 360);
  const H = Math.round((W * size.h) / size.w);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext("2d");
  g.fillStyle = "#0b1626";
  g.fillRect(0, 0, W, H);
  if (previewImg) {
    const s = Math.max(W / previewImg.width, H / previewImg.height);
    g.drawImage(previewImg, (W - previewImg.width * s) / 2, (H - previewImg.height * s) / 2, previewImg.width * s, previewImg.height * s);
  } else {
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#1565ff");
    grad.addColorStop(1, "#0b1d4a");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }
  if (S.capMode === "off") {
    g.fillStyle = "rgba(0,0,0,.5)";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#c9d6ee";
    g.font = "600 18px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("Captions band hain", W / 2, H / 2);
    return;
  }
  await ensureFont(S.capFont);
  drawCaption(g, W, H, sample(), captionStyle());
}
const captionStyle = () => ({ font: S.capFont, size: S.capSize / 100, pos: S.capPos, theme: S.capTheme, upper: S.upper, box: S.box });

function syncControls() {
  $$("[data-k]").forEach((el) => (el.checked = !!S[el.dataset.k]));
  $$("[data-seg]").forEach((g) => $$("button", g).forEach((b) => b.classList.toggle("on", String(S[g.dataset.seg]) === b.dataset.v)));
  $$("[data-sel]").forEach((el) => (el.value = String(S[el.dataset.sel])));
  $("capSize").value = S.capSize;
  $("capSizeV").textContent = S.capSize;
  $$("#swatches button").forEach((b) => b.classList.toggle("on", b.dataset.id === S.capTheme));
  $$("#presets .preset").forEach((b) => b.classList.toggle("on", b.dataset.id === S.preset));
  updateSummary();
  drawPreview();
}

// presets
PRESETS.forEach((p) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "preset";
  b.dataset.id = p.id;
  b.innerHTML = `<b></b><small></small>`;
  b.querySelector("b").textContent = p.name;
  b.querySelector("small").textContent = p.sub;
  b.onclick = () => { Object.assign(S, p.set, { preset: p.id }); syncControls(); };
  $("presets").appendChild(b);
});
// swatches
THEMES.forEach((t) => {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.id = t.id;
  b.setAttribute("aria-label", t.name);
  b.innerHTML = `<i style="background:linear-gradient(135deg,${t.chip[0]} 50%,${t.chip[1]} 50%)"></i>`;
  b.onclick = () => { S.capTheme = t.id; S.preset = "custom"; syncControls(); };
  $("swatches").appendChild(b);
});
// sizes
for (const [k, v] of Object.entries(SIZES)) {
  const o = document.createElement("option");
  o.value = k;
  o.textContent = v.label;
  $("size").appendChild(o);
}
$$("[data-k]").forEach((el) => el.addEventListener("change", () => { S[el.dataset.k] = el.checked; S.preset = "custom"; syncControls(); }));
$$("[data-seg]").forEach((g) =>
  $$("button", g).forEach((b) => b.addEventListener("click", () => {
    S[g.dataset.seg] = b.dataset.v;
    if (g.dataset.seg !== "fps") S.preset = "custom";
    syncControls();
  }))
);
$$("[data-sel]").forEach((el) => el.addEventListener("change", () => { S[el.dataset.sel] = el.value; S.preset = "custom"; syncControls(); }));
$("capSize").addEventListener("input", () => { S.capSize = Number($("capSize").value); $("capSizeV").textContent = S.capSize; drawPreview(); });

// ---------------------------------------------------------------- ffmpeg
async function getFF() {
  if (state.ffmpeg) return state.ffmpeg;
  $("status").textContent = "Editor khul raha hai…";
  const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => state.logFn && state.logFn(message));
  await ffmpeg.load({
    coreURL: new URL("./vendor/core/ffmpeg-core.js", location.href).href,
    wasmURL: new URL("./vendor/core/ffmpeg-core.wasm", location.href).href,
  });
  state.ffmpeg = ffmpeg;
  return ffmpeg;
}
const adapter = (ffmpeg) => ({
  write: (n, b) => ffmpeg.writeFile(n, b),
  exec: (a) => ffmpeg.exec(a),
  read: (n) => ffmpeg.readFile(n),
  del: (n) => ffmpeg.deleteFile(n).catch(() => {}),
  logTo: (fn) => { state.logFn = fn; },
});

async function prepareImage(file, w, h) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, w, h);
  const s = Math.max(w / bmp.width, h / bmp.height);
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, (w - bmp.width * s) / 2, (h - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  bmp.close && bmp.close();
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
  c.width = c.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------------------------------------------------------------- results / play
const plugin = (n) => (cap.Plugins && cap.Plugins[n]) || cap.registerPlugin(n);
function b64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
async function writeNative(r) {
  if (r.uri) return r.uri;
  const fs = plugin("Filesystem");
  const CH = 3 * 1024 * 1024;
  for (let o = 0; o < r.blob.size; o += CH) {
    const data = b64(new Uint8Array(await r.blob.slice(o, o + CH).arrayBuffer()));
    if (o === 0) await fs.writeFile({ path: r.name, data, directory: "CACHE" });
    else await fs.appendFile({ path: r.name, data, directory: "CACHE" });
  }
  r.uri = (await fs.getUri({ path: r.name, directory: "CACHE" })).uri;
  return r.uri;
}

function playResult(i) {
  state.playing = i;
  const r = state.results[i];
  const v = $("player");
  if (v.dataset.url) URL.revokeObjectURL(v.dataset.url);
  const url = URL.createObjectURL(r.blob);
  v.dataset.url = url;
  v.src = url;
  $$("#partChips button").forEach((b, k) => b.classList.toggle("on", k === i));
  $("playMeta").textContent = `${r.name} · ${fmt(r.seconds)} · ${(r.blob.size / 1048576).toFixed(1)} MB`;
  const act = $("playActions");
  act.innerHTML = "";
  if (isNative) {
    const b = document.createElement("button");
    b.textContent = "Save / Share";
    b.onclick = async () => {
      try {
        b.disabled = true;
        b.textContent = "Tayyar ho raha hai…";
        const uri = await writeNative(r);
        await plugin("Share").share({ title: r.name, url: uri, dialogTitle: "Video save ya share karein" });
      } catch (e) {
        showError("Save nahi hua: " + (e.message || e));
      } finally {
        b.disabled = false;
        b.textContent = "Save / Share";
      }
    };
    act.appendChild(b);
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = r.name;
    a.textContent = "Download";
    act.appendChild(a);
  }
}
function renderPlay() {
  const has = state.results.length > 0;
  $("playEmpty").hidden = has;
  $("playBox").hidden = !has;
  const chips = $("partChips");
  chips.innerHTML = "";
  chips.hidden = state.results.length < 2;
  state.results.forEach((r, i) => {
    const b = document.createElement("button");
    b.textContent = state.results.length > 1 ? `Part ${i + 1}` : r.name;
    b.onclick = () => playResult(i);
    chips.appendChild(b);
  });
  if (has) playResult(Math.max(0, state.playing));
  renderHome();
}

// ---------------------------------------------------------------- generate
async function start() {
  showError("");
  if (!state.images.length) { showError("Pehle Studio mein images chunein."); return; }
  state.running = true;
  state.cancelled = false;
  state.results = [];
  state.playing = -1;
  $("sheet").hidden = false;
  $("pct").textContent = "0%";
  $("reelFill").style.width = "0%";
  $("status").textContent = "";
  $("eta").textContent = "";
  let wake = null;
  try { wake = await navigator.wakeLock?.request("screen"); } catch {}

  try {
    const size = SIZES[S.size];
    const sc = effZoomScale();
    const sw = even(size.w * sc), sh = even(size.h * sc);
    const ffmpeg = await getFF();
    const ff = adapter(ffmpeg);
    const t0 = Date.now();

    const voice = state.voice
      ? { ext: state.voice.ext, duration: state.voice.duration, bytes: new Uint8Array(await state.voice.file.arrayBuffer()) }
      : null;
    const music = state.music
      ? { ext: state.music.ext, bytes: new Uint8Array(await state.music.file.arrayBuffer()) }
      : null;

    // pauses ek baar nikalna: cut aur captions dono ke kaam aate hain
    let anchors = [];
    const wantCaps = S.capMode !== "off" && $("script").value.trim() && voice && voice.duration;
    if (voice && voice.duration && ($("snap").checked || wantCaps)) {
      $("status").textContent = "Awaaz ke pauses dhoond raha hoon…";
      await ff.write("probe." + voice.ext, voice.bytes.slice());
      try { anchors = await detectPauses(ff, "probe." + voice.ext); } catch { anchors = []; }
      await ff.del("probe." + voice.ext);
      voice.pauses = anchors;
    }

    const fps = Number(S.fps);
    const total = totalSeconds();
    let items = [];
    if (wantCaps) {
      items = buildCaptionItems({
        script: $("script").value, total, anchors,
        mode: S.capMode === "word" ? "word" : "line", perChunk: 3,
      });
      await ensureFont(S.capFont);
    }
    const style = captionStyle();
    const cache = new Map();
    const getCaption = async (it) => {
      const key = it.words.join("\u0001") + "|" + it.active;
      if (cache.has(key)) return cache.get(key).slice();
      const png = await captionPNG(it, style, size.w, size.h);
      cache.set(key, png);
      if (cache.size > 8) cache.delete(cache.keys().next().value);
      return png.slice();
    };

    const res = await buildVideo({
      ff,
      count: state.images.length,
      getImage: (i) => prepareImage(state.images[i].file, sw, sh),
      voice, music,
      captionItems: items,
      getCaption,
      opts: {
        w: size.w, h: size.h, fps,
        motion: S.motion, motionAmt: 1, punch: S.punch, shake: S.shake,
        look: S.look, vignette: S.vignette, grain: S.grain, bars: S.bars,
        transition: S.transition, transSec: 0.5, seed: Math.floor(Math.random() * 99999) + 1,
        voiceClean: S.voiceClean,
        perImageSec: perImg(), matchVoice: matching(), snap: $("snap").checked,
        partMinutes: Number(S.partMin),
        voiceVol: 1, musicVol: Number($("musicVol").value) / 100,
        sfx: S.sfx, sfxVol: 0.5, duck: S.duck,
      },
      isCancelled: () => state.cancelled,
      onProgress: (p) => {
        const pc = Math.round(p.fraction * 100);
        $("pct").textContent = pc + "%";
        $("reelFill").style.width = pc + "%";
        $("status").textContent = p.text;
        if (p.fraction > 0.03 && p.fraction < 1) {
          const el = (Date.now() - t0) / 1000;
          $("eta").textContent = `Taqreeban ${fmt((el / p.fraction) * (1 - p.fraction))} baqi`;
        }
      },
      onPart: async (p) => {
        state.results.push({ name: p.name, blob: new Blob([p.bytes], { type: "video/mp4" }), seconds: p.seconds });
      },
    });
    renderPlay();
    showTab("play");
  } catch (e) {
    if (!state.cancelled) showError(String(e.message || e));
  } finally {
    state.running = false;
    $("sheet").hidden = true;
    try { wake && (await wake.release()); } catch {}
  }
}
$("go").addEventListener("click", start);
$("stop").addEventListener("click", () => {
  state.cancelled = true;
  try { state.ffmpeg && state.ffmpeg.terminate(); } catch {}
  state.ffmpeg = null;
});

// ---------------------------------------------------------------- boot
$("musicVolV").textContent = $("musicVol").value;
syncControls();
renderStrip();
renderPlay();
showTab("home");
loadFonts().then(drawPreview);
