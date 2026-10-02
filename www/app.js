import { buildVideo, SIZES, even } from "./pipeline.js";

const $ = (id) => document.getElementById(id);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const cap = window.Capacitor;
const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

const state = {
  images: [], // { file, url }
  voice: null, // { file, ext, duration }
  music: null,
  running: false,
  cancelled: false,
  ffmpeg: null,
};

// ---------- chhote helpers ----------
const fmt = (s) => {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};
const extOf = (name) =>
  ((name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin");
const log = (m) => {
  const el = $("log");
  el.textContent += m + "\n";
  if (el.textContent.length > 20000) el.textContent = el.textContent.slice(-12000);
};
const showError = (m) => {
  $("err").hidden = !m;
  $("err").textContent = m || "";
};
window.addEventListener("error", (e) => showError("Error: " + e.message));
window.addEventListener("unhandledrejection", (e) =>
  showError("Error: " + (e.reason && e.reason.message ? e.reason.message : e.reason))
);

function audioDuration(file) {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = (v) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : null);
    a.onerror = () => done(null);
    a.src = url;
  });
}

// ---------- images list ----------
function renderImages() {
  const ul = $("imgList");
  ul.innerHTML = "";
  state.images.forEach((it, i) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<img loading="lazy" alt=""><span class="nm"></span>` +
      `<button type="button" data-a="up">↑</button>` +
      `<button type="button" data-a="down">↓</button>` +
      `<button type="button" data-a="del">✕</button>`;
    li.querySelector("img").src = it.url;
    li.querySelector(".nm").textContent = `${i + 1}. ${it.file.name}`;
    li.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        const a = b.dataset.a;
        if (a === "del") {
          URL.revokeObjectURL(it.url);
          state.images.splice(i, 1);
        } else {
          const j = a === "up" ? i - 1 : i + 1;
          if (j < 0 || j >= state.images.length) return;
          [state.images[i], state.images[j]] = [state.images[j], state.images[i]];
        }
        renderImages();
      })
    );
    ul.appendChild(li);
  });
  $("imgCount").textContent = state.images.length ? `${state.images.length} images` : "";
  updateSummary();
}

$("imgs").addEventListener("change", (e) => {
  const files = [...e.target.files];
  files.sort((a, b) => collator.compare(a.name, b.name));
  for (const file of files) state.images.push({ file, url: URL.createObjectURL(file) });
  e.target.value = "";
  renderImages();
});
$("sortName").addEventListener("click", () => {
  state.images.sort((a, b) => collator.compare(a.file.name, b.file.name));
  renderImages();
});
$("clearImgs").addEventListener("click", () => {
  state.images.forEach((i) => URL.revokeObjectURL(i.url));
  state.images = [];
  renderImages();
});

// ---------- audio ----------
$("voice").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const duration = await audioDuration(file);
  state.voice = { file, ext: extOf(file.name), duration };
  const mb = file.size / 1048576;
  $("voiceInfo").textContent =
    `${file.name} — ${duration ? fmt(duration) : "lambai maloom nahi"}` +
    (mb > 150 ? " ⚠️ file bohat bhari hai, mp3/m4a istemal karein" : "");
  updateSummary();
});
$("music").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  state.music = { file, ext: extOf(file.name) };
  $("musicInfo").textContent = file.name;
});
$("musicVol").addEventListener("input", () => ($("musicVolV").textContent = $("musicVol").value));

// ---------- settings ----------
for (const [k, v] of Object.entries(SIZES)) {
  const o = document.createElement("option");
  o.value = k;
  o.textContent = v.label;
  $("size").appendChild(o);
}
$("size").value = "landscape720";

function matching() {
  return !!(state.voice && state.voice.duration && $("matchVoice").checked);
}
function updateSummary() {
  const n = state.images.length;
  $("perImgWrap").hidden = matching();
  if (!n) {
    $("summary").textContent = "";
    return;
  }
  if (matching()) {
    const d = state.voice.duration;
    $("summary").textContent = `${n} images, kul ${fmt(d)}, har image ~${(d / n).toFixed(1)} second.`;
  } else {
    const per = Number($("perImg").value) || 4;
    $("summary").textContent = `${n} images × ${per}s = ${fmt(n * per)}.`;
  }
}
["matchVoice", "perImg"].forEach((id) => $(id).addEventListener("input", updateSummary));

// ---------- ffmpeg ----------
async function getFF() {
  if (state.ffmpeg) return state.ffmpeg;
  $("status").textContent = "ffmpeg khul raha hai (pehli baar thora time lagta hai)…";
  const { FFmpeg } = await import("./vendor/ffmpeg/index.js");
  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => log(message));
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
});

// image ko canvas par cover-fit karke chhota JPEG banana (phone ki photo bohat badi hoti hai)
async function prepareImage(file, w, h) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, w, h);
  const s = Math.max(w / bmp.width, h / bmp.height);
  const dw = bmp.width * s;
  const dh = bmp.height * s;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
  bmp.close && bmp.close();
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
  c.width = c.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------- save / share ----------
function b64(u8) {
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) s += String.fromCharCode.apply(null, u8.subarray(i, i + step));
  return btoa(s);
}
const plugin = (n) => (cap.Plugins && cap.Plugins[n]) || cap.registerPlugin(n);

async function writeNative(name, bytes) {
  const fs = plugin("Filesystem");
  const CH = 3 * 1024 * 1024; // 3MB (3 ka multiple => base64 jodne par masla nahi)
  for (let o = 0; o < bytes.length; o += CH) {
    const data = b64(bytes.subarray(o, o + CH));
    if (o === 0) await fs.writeFile({ path: name, data, directory: "CACHE" });
    else await fs.appendFile({ path: name, data, directory: "CACHE" });
  }
  const { uri } = await fs.getUri({ path: name, directory: "CACHE" });
  return uri;
}

async function addResult(p) {
  const li = document.createElement("li");
  const label = document.createElement("span");
  label.textContent = `${p.name} (${fmt(p.seconds)}, ${(p.bytes.length / 1048576).toFixed(1)} MB)`;
  li.appendChild(label);
  if (isNative) {
    const uri = await writeNative(p.name, p.bytes);
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Save / Share";
    b.onclick = () =>
      plugin("Share")
        .share({ title: p.name, url: uri, dialogTitle: "Video save ya share karein" })
        .catch((e) => showError("Share nahi hua: " + (e.message || e)));
    li.appendChild(b);
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([p.bytes], { type: "video/mp4" }));
    a.download = p.name;
    a.textContent = "Download";
    li.appendChild(a);
  }
  $("results").appendChild(li);
}

// ---------- main ----------
async function start() {
  showError("");
  if (!state.images.length) return showError("Pehle images chunein.");
  state.running = true;
  state.cancelled = false;
  $("go").disabled = true;
  $("stop").hidden = false;
  $("bar").hidden = false;
  $("barFill").style.width = "0%";
  $("results").innerHTML = "";
  let wake = null;
  try {
    wake = await navigator.wakeLock?.request("screen");
  } catch {}

  try {
    const size = SIZES[$("size").value];
    const zoom = $("zoom").checked;
    const scale = zoom ? 1.5 : 1;
    const sw = even(size.w * scale);
    const sh = even(size.h * scale);
    const ffmpeg = await getFF();
    const t0 = Date.now();

    const voice = state.voice
      ? {
          ext: state.voice.ext,
          duration: state.voice.duration,
          bytes: new Uint8Array(await state.voice.file.arrayBuffer()),
        }
      : null;
    const music = state.music
      ? { ext: state.music.ext, bytes: new Uint8Array(await state.music.file.arrayBuffer()) }
      : null;

    const res = await buildVideo({
      ff: adapter(ffmpeg),
      count: state.images.length,
      getImage: (i) => prepareImage(state.images[i].file, sw, sh),
      voice,
      music,
      opts: {
        w: size.w,
        h: size.h,
        fps: Number($("fps").value),
        zoom,
        fadeSec: Number($("fade").value) || 0,
        perImageSec: Number($("perImg").value) || 4,
        matchVoice: matching(),
        partMinutes: Number($("partMin").value),
        voiceVol: 1,
        musicVol: Number($("musicVol").value) / 100,
      },
      isCancelled: () => state.cancelled,
      onProgress: (p) => {
        $("barFill").style.width = Math.round(p.fraction * 100) + "%";
        let eta = "";
        if (p.fraction > 0.03 && p.fraction < 1) {
          const el = (Date.now() - t0) / 1000;
          eta = ` — taqreeban ${fmt((el / p.fraction) * (1 - p.fraction))} baqi`;
        }
        $("status").textContent = p.text + eta;
      },
      onPart: addResult,
    });
    $("status").textContent = `Ho gaya! ${res.parts} file, kul ${fmt(res.seconds)}.`;
  } catch (e) {
    if (state.cancelled) $("status").textContent = "Rok diya gaya.";
    else {
      showError(String(e.message || e));
      $("status").textContent = "";
    }
  } finally {
    state.running = false;
    $("go").disabled = false;
    $("stop").hidden = true;
    try {
      wake && (await wake.release());
    } catch {}
  }
}

$("go").addEventListener("click", start);
$("stop").addEventListener("click", () => {
  state.cancelled = true;
  try {
    state.ffmpeg && state.ffmpeg.terminate();
  } catch {}
  state.ffmpeg = null; // agli baar dobara load hoga
});

renderImages();
