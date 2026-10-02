// pipeline.js — images + voiceover se video banane ka logic.
// Ye file browser/DOM par depend nahi karti. `ff` adapter ke 4 kaam:
//   ff.write(name, Uint8Array)   ff.exec(argsArray) -> exit code
//   ff.read(name) -> Uint8Array  ff.del(name)

export const SIZES = {
  landscape720: { w: 1280, h: 720, label: "Landscape 720p (YouTube)" },
  landscape480: { w: 854, h: 480, label: "Landscape 480p (halka, tez)" },
  portrait720: { w: 720, h: 1280, label: "Portrait 720p (Reels/Shorts)" },
  portrait480: { w: 480, h: 854, label: "Portrait 480p (halka, tez)" },
};

export const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// Har image ke kitne frames honge (voiceover se match, ya fixed seconds)
export function planFrames(count, fps, { perImageSec, totalSec }) {
  const total = totalSec ?? count * perImageSec;
  const out = [];
  let prev = 0;
  for (let i = 0; i < count; i++) {
    const end = Math.round(((i + 1) * total * fps) / count);
    out.push(Math.max(2, end - prev));
    prev = end;
  }
  return out;
}

// Segments ko hisson (parts) mein baantna. partMinutes=0 => ek hi file.
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
    // chhota bacha hua hissa pichle part mein mila dein
    if (parts.length && acc < limit * 0.25) parts[parts.length - 1][1] = n;
    else parts.push([start, n]);
  }
  return parts;
}

const num = (x) => Number(x).toFixed(3);

function segmentArgs({ i, frames, fps, w, h, zoom, fadeSec }) {
  const dur = frames / fps;
  const f = Math.max(0, Math.min(fadeSec, dur / 3));
  const chain = [];
  if (zoom) {
    const zr = 0.12;
    const t = Math.max(1, frames - 1);
    const z = i % 2 === 0 ? `1+${zr}*on/${t}` : `1+${zr}*(1-on/${t})`;
    chain.push(
      `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${fps}`
    );
  } else {
    chain.push(`scale=${w}:${h}`);
  }
  if (f > 0) {
    chain.push(`fade=t=in:st=0:d=${num(f)}`);
    chain.push(`fade=t=out:st=${num(dur - f)}:d=${num(f)}`);
  }
  chain.push("format=yuv420p");
  return [
    "-y",
    "-loop", "1",
    "-framerate", String(fps),
    "-i", `img_${i}.jpg`,
    "-frames:v", String(frames),
    "-vf", chain.join(","),
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "27",
    "-pix_fmt", "yuv420p",
    "-an",
    `seg_${i}.mp4`,
  ];
}

function muxArgs({ video, out, voice, music, start, dur, voiceVol, musicVol }) {
  const args = ["-y", "-i", video];
  let idx = 1;
  let vIdx = -1;
  let mIdx = -1;
  if (voice) {
    args.push("-ss", num(start), "-i", voice);
    vIdx = idx++;
  }
  if (music) {
    args.push("-stream_loop", "-1", "-i", music);
    mIdx = idx++;
  }
  if (vIdx < 0 && mIdx < 0) {
    return [...args, "-c", "copy", "-movflags", "+faststart", out];
  }
  let fc;
  if (vIdx >= 0 && mIdx >= 0) {
    fc =
      `[${vIdx}:a]apad,volume=${voiceVol}[v];` +
      `[${mIdx}:a]volume=${musicVol}[m];` +
      `[v][m]amix=inputs=2:duration=first:normalize=0[a]`;
  } else if (vIdx >= 0) {
    fc = `[${vIdx}:a]apad,volume=${voiceVol}[a]`;
  } else {
    fc = `[${mIdx}:a]volume=${musicVol}[a]`;
  }
  return [
    ...args,
    "-filter_complex", fc,
    "-map", "0:v:0",
    "-map", "[a]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "128k",
    "-t", num(dur),
    "-movflags", "+faststart",
    out,
  ];
}

/**
 * opts: { w, h, fps, zoom, fadeSec, perImageSec, matchVoice, partMinutes,
 *         voiceVol, musicVol }
 * count: images ki tadaad; getImage(i) -> Promise<Uint8Array> (jpg, tayyar size mein)
 * voice / music: { ext, bytes, duration? } ya null
 */
export async function buildVideo({
  ff,
  count,
  getImage,
  voice,
  music,
  opts,
  onProgress = () => {},
  onPart = async () => {},
  isCancelled = () => false,
}) {
  const { w, h, fps } = opts;
  if (!count) throw new Error("Koi image nahi chuni.");

  const totalSec =
    voice && opts.matchVoice && voice.duration ? voice.duration : null;
  const frames = planFrames(count, fps, {
    perImageSec: opts.perImageSec,
    totalSec,
  });
  const parts = planParts(frames, fps, opts.partMinutes);
  const totalFrames = frames.reduce((a, b) => a + b, 0);

  const check = () => {
    if (isCancelled()) throw new Error("Cancel kar diya gaya.");
  };
  const run = async (args, what) => {
    check();
    const code = await ff.exec(args);
    if (code !== 0) throw new Error(`ffmpeg fail (${what}), code ${code}`);
  };

  const voiceName = voice ? `voice.${voice.ext}` : null;
  const musicName = music ? `music.${music.ext}` : null;
  if (voice) await ff.write(voiceName, voice.bytes);
  if (music) await ff.write(musicName, music.bytes);

  let doneImages = 0;
  const startFrame = [0];
  for (let i = 0; i < count; i++) startFrame.push(startFrame[i] + frames[i]);

  for (let p = 0; p < parts.length; p++) {
    const [a, b] = parts[p];
    const segNames = [];
    for (let i = a; i < b; i++) {
      onProgress({
        stage: "segment",
        part: p + 1,
        parts: parts.length,
        fraction: doneImages / count,
        text: `Part ${p + 1}/${parts.length} — image ${i + 1}/${count}`,
      });
      check();
      const bytes = await getImage(i);
      await ff.write(`img_${i}.jpg`, bytes);
      await run(
        segmentArgs({
          i,
          frames: frames[i],
          fps,
          w,
          h,
          zoom: opts.zoom,
          fadeSec: opts.fadeSec,
        }),
        `image ${i + 1}`
      );
      await ff.del(`img_${i}.jpg`);
      segNames.push(`seg_${i}.mp4`);
      doneImages++;
    }

    onProgress({
      stage: "join",
      part: p + 1,
      parts: parts.length,
      fraction: doneImages / count,
      text: `Part ${p + 1}/${parts.length} — jod raha hoon aur awaaz laga raha hoon`,
    });
    const list = segNames.map((n) => `file '${n}'`).join("\n") + "\n";
    await ff.write("list.txt", new TextEncoder().encode(list));
    await run(
      ["-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "pv.mp4"],
      "join"
    );

    const partFrames = startFrame[b] - startFrame[a];
    const out = `out_${p + 1}.mp4`;
    await run(
      muxArgs({
        video: "pv.mp4",
        out,
        voice: voiceName,
        music: musicName,
        start: startFrame[a] / fps,
        dur: partFrames / fps,
        voiceVol: opts.voiceVol ?? 1,
        musicVol: opts.musicVol ?? 0.15,
      }),
      "audio"
    );

    for (const n of segNames) await ff.del(n);
    await ff.del("pv.mp4");
    await ff.del("list.txt");

    const data = await ff.read(out);
    await onPart({
      index: p + 1,
      total: parts.length,
      name: parts.length === 1 ? "movie.mp4" : `movie_part${p + 1}.mp4`,
      bytes: data,
      seconds: partFrames / fps,
    });
    await ff.del(out);
  }

  onProgress({ stage: "done", fraction: 1, text: "Ho gaya!" });
  return { parts: parts.length, seconds: totalFrames / fps };
}
