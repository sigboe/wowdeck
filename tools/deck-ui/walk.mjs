// node walk.mjs <target> <measure.js> [--diff] <ArrowUp|ArrowDown|ArrowLeft|ArrowRight ...>  - press each key in turn and print the measurement after it
// --diff prints only the fields that changed since the previous press (fewer tokens, same signal).
import fs from "node:fs";
import { connect, fail } from "./cdp.mjs";

const ALLOWED = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };
const args = process.argv.slice(2).filter((a) => a !== "--diff");
const diff = process.argv.includes("--diff");
const [want, file, ...keys] = args;
const expr = fs.readFileSync(file, "utf8");
try {
  const { send, close } = await connect(want);
  let prev = null;
  const parse = (v) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };
  for (const key of keys) { if (!(key in ALLOWED)) continue; const code = ALLOWED[key];
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await new Promise(r => setTimeout(r, 350));
    const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    const value = res.result?.result?.value ?? res.result?.exceptionDetails?.exception?.description;
    const cur = diff ? parse(value) : null;
    if (diff && cur && prev && typeof cur === "object" && typeof prev === "object") {
      const changed = Object.keys(cur).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(prev[k]));
      console.log(key.padEnd(10), changed.length ? changed.map((k) => `${k}=${JSON.stringify(cur[k])}`).join(" ") : "-");
      prev = cur;
    } else {
      console.log(key.padEnd(10), value);
      prev = cur;
    }
  }
  close(); process.exit(0);
} catch (e) { fail(e); }
