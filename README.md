# Video Maker

Images + voiceover se video banane wali Android app (ffmpeg.wasm, phone par offline).

## APK kaise milega
1. Ye poora folder GitHub repo mein push karein (branch `main`).
2. GitHub par repo kholein -> **Actions** tab -> **Build APK**. 10-15 minute mein green tick aayega.
3. Us run par click karein -> neeche **Artifacts** -> `video-maker-apk` download karein (zip hai, andar `app-debug.apk`).
4. Phone mein APK install karein (Unknown sources allow karna parega).

Agar build khud na chale: Actions -> Build APK -> **Run workflow**.

## Test (optional, PC par)
`node test/pipeline.test.mjs` (native ffmpeg chahiye)
