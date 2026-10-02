// Android project ko patch: zyada memory (largeHeap) aur hardware acceleration
import { readFileSync, writeFileSync } from "node:fs";

const f = "android/app/src/main/AndroidManifest.xml";
let x = readFileSync(f, "utf8");
if (!x.includes("android:largeHeap")) {
  x = x.replace("<application", '<application android:largeHeap="true" android:hardwareAccelerated="true"');
}
writeFileSync(f, x);
console.log("Manifest patched");
console.log(x.split("\n").slice(0, 12).join("\n"));
