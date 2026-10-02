// captions.js — script text se caption ka waqt nikalna (DOM se azaad)

export const isRTL = (s) => /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(s);

export function splitLines(script) {
  return script
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=[.!?۔؟])\s+/))
    .map((l) => l.trim())
    .filter(Boolean);
}

const weight = (s) => Math.max(2, [...s].length + 1);

/**
 * script: awaaz ka text. total: voiceover ki lambai (second).
 * anchors: pauses ke waqt. mode: 'line' | 'word'. perChunk: ek caption mein kitne alfaaz.
 * Wapas: [{ start, end, words:[...], active:-1|index }]
 */
export function buildCaptionItems({ script, total, anchors = [], mode = "line", perChunk = 3 }) {
  const lines = splitLines(script || "");
  if (!lines.length || !total) return [];

  const lw = lines.map((l) => lines.length && [...l].length + 2);
  const sum = lw.reduce((a, b) => a + b, 0);
  const bounds = [0];
  let acc = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    acc += lw[i];
    let t = (acc / sum) * total;
    let best = null;
    for (const a of anchors) if (Math.abs(a - t) <= 1.2 && (best === null || Math.abs(a - t) < Math.abs(best - t))) best = a;
    if (best !== null) t = best;
    bounds.push(Math.max(t, bounds[bounds.length - 1] + 0.2));
  }
  bounds.push(total);

  const items = [];
  lines.forEach((line, li) => {
    const t0 = bounds[li];
    const t1 = Math.max(bounds[li + 1], t0 + 0.3);
    const words = line.split(/\s+/).filter(Boolean);
    const ww = words.map(weight);
    const wsum = ww.reduce((a, b) => a + b, 0);
    const wt = [];
    let cur = t0;
    words.forEach((w, k) => {
      const d = ((t1 - t0) * ww[k]) / wsum;
      wt.push([cur, cur + d]);
      cur += d;
    });
    for (let s = 0; s < words.length; s += perChunk) {
      const e = Math.min(words.length, s + perChunk);
      const chunk = words.slice(s, e);
      if (mode === "word") {
        for (let k = s; k < e; k++) {
          items.push({ start: wt[k][0], end: wt[k][1], words: chunk, active: k - s });
        }
      } else {
        items.push({ start: wt[s][0], end: wt[e - 1][1], words: chunk, active: -1 });
      }
    }
  });
  // chhote gap bharna taake caption jhapke nahi
  for (let i = 0; i + 1 < items.length; i++) {
    const gap = items[i + 1].start - items[i].end;
    if (gap > 0 && gap < 0.35) items[i].end = items[i + 1].start;
  }
  return items.filter((it) => it.end - it.start > 0.04);
}
