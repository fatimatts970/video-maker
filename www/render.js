// render.js — caption ko canvas par banakar transparent PNG banana (browser)
import { isRTL } from "./captions.js";

export const THEMES = [
  { id: "yellow", name: "Safed + peela", fill: "#ffffff", hi: "#ffc83d", stroke: "#000000", chip: ["#ffffff", "#ffc83d"] },
  { id: "white", name: "Safed", fill: "#ffffff", hi: "#ffffff", stroke: "#000000", chip: ["#ffffff", "#ffffff"] },
  { id: "amber", name: "Peela", fill: "#ffc83d", hi: "#ff6a3d", stroke: "#000000", chip: ["#ffc83d", "#ff6a3d"] },
  { id: "cyan", name: "Neela", fill: "#ffffff", hi: "#37e0ff", stroke: "#001418", chip: ["#ffffff", "#37e0ff"] },
  { id: "green", name: "Hara", fill: "#ffffff", hi: "#6dff7a", stroke: "#001a05", chip: ["#ffffff", "#6dff7a"] },
];

/** st: { font, size (0..1 of H), pos, theme, upper, box } */
export function drawCaption(ctx, W, H, item, st) {
  const words = item.words;
  if (!words || !words.length) return;
  const th = THEMES.find((t) => t.id === st.theme) || THEMES[0];
  const rtl = isRTL(words.join(" "));
  const px = Math.round(H * st.size);
  const weight = st.font === "Poppins" ? 800 : 700;
  const family = `"${st.font}", "Noto Naskh Arabic", "Noto Sans", sans-serif`;
  ctx.font = `${weight} ${px}px ${family}`;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  if ("direction" in ctx) ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = "left";

  const shown = words.map((w) => (st.upper && !rtl ? w.toUpperCase() : w));
  const space = ctx.measureText(" ").width * (rtl ? 1.1 : 1);
  const widths = shown.map((w) => ctx.measureText(w).width);
  const maxW = W * 0.88;

  // lines mein baantna
  const lines = [];
  let cur = { idx: [], w: 0 };
  shown.forEach((w, i) => {
    const add = widths[i] + (cur.idx.length ? space : 0);
    if (cur.idx.length && cur.w + add > maxW) {
      lines.push(cur);
      cur = { idx: [], w: 0 };
    }
    cur.w += widths[i] + (cur.idx.length ? space : 0);
    cur.idx.push(i);
  });
  lines.push(cur);

  const lh = px * (rtl ? 1.7 : 1.25);
  const blockH = lh * lines.length;
  const top = st.pos === "center" ? (H - blockH) / 2 : H * 0.88 - blockH;

  lines.forEach((ln, li) => {
    const base = top + li * lh + px * (rtl ? 1.15 : 0.95);
    if (st.box) {
      ctx.fillStyle = "rgba(0,0,0,0.62)";
      const pad = px * 0.35;
      const x0 = (W - ln.w) / 2 - pad;
      const y0 = base - px * (rtl ? 1.05 : 0.95) - pad * 0.3;
      const bw = ln.w + pad * 2;
      const bh = px * (rtl ? 1.5 : 1.2) + pad * 0.6;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0, y0, bw, bh, px * 0.22);
      else ctx.rect(x0, y0, bw, bh);
      ctx.fill();
    }
    let x = rtl ? (W + ln.w) / 2 : (W - ln.w) / 2;
    ln.idx.forEach((i) => {
      const w = shown[i];
      const left = rtl ? x - widths[i] : x;
      ctx.lineWidth = px * 0.18;
      ctx.strokeStyle = th.stroke;
      ctx.strokeText(w, left, base);
      ctx.fillStyle = item.active === i ? th.hi : th.fill;
      ctx.fillText(w, left, base);
      x += rtl ? -(widths[i] + space) : widths[i] + space;
    });
  });
}

export async function captionPNG(item, st, W, H) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  drawCaption(c.getContext("2d"), W, H, item, st);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  c.width = c.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}
