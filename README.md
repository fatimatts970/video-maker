# Cutroom (Video Maker)

Images + voiceover se video banane wali Android app (ffmpeg.wasm, phone par offline).

## APK kaise milega
1. Ye poora folder GitHub repo mein push karein (branch `main`).
2. GitHub par repo kholein -> **Actions** tab -> **Build APK**. 10-15 minute mein green tick aayega.
3. Us run par click karein -> neeche **Artifacts** -> `video-maker-apk` download karein (zip hai, andar `app-debug.apk`).
4. Phone mein APK install karein (Unknown sources allow karna parega).

Agar build khud na chale: Actions -> Build APK -> **Run workflow**.

## Test (optional, PC par)
`node test/pipeline.test.mjs` (native ffmpeg chahiye)

## Kya kya hai
- Images + voiceover se video, sab phone par (ffmpeg.wasm)
- Captions (jumla ya lafz lafz), script text se; Urdu/Roman Urdu dono
- Voiceover ke pauses dhoond kar cuts jumlon par lagana
- Effects: zoom, punch zoom, camera shake, rang nikhaar, flash/fade cut, whoosh sound, music ducking
- Play screen, aur 5/10 minute ke hisson mein export
