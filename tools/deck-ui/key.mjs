// Navigation-only key sender: node key.mjs <titleSubstr> <ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Escape> [count] [delayMs]
import { connect, fail } from "./cdp.mjs";

const ALLOWED = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Escape: 27 }; // Escape = B (back/cancel)
const [,, want, key, countS, delayS] = process.argv;
if (!(key in ALLOWED)) { console.error("key not allowed:", key); process.exit(2); }
try {
  const { send, close } = await connect(want);
  const code = ALLOWED[key];
  for (let i = 0; i < Number(countS || 1); i++) {
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await new Promise(r => setTimeout(r, Number(delayS || 400)));
  }
  close(); process.exit(0);
} catch (e) { fail(e); }
