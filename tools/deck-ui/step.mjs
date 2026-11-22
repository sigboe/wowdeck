// node step.mjs <target> <ArrowUp|ArrowDown> <count> <delayMs> <evalFile> [--diff]  (navigation keys only)
// --diff prints only the fields that changed since the previous press.
import fs from "node:fs";
import { connect, fail } from "./cdp.mjs";

const ALLOWED = { ArrowUp: 38, ArrowDown: 40 };
const args = process.argv.slice(2).filter((a) => a !== "--diff");
const diff = process.argv.includes("--diff");
const [want, key, countS, delayS, file] = args;
if (!(key in ALLOWED)) process.exit(2);
const expr = fs.readFileSync(file, "utf8");
try {
  const { send, close } = await connect(want);
  const code = ALLOWED[key];
  let prev = null;
  const parse = (v) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };
  for (let i = 0; i < Number(countS); i++) {
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await new Promise(r => setTimeout(r, Number(delayS)));
    const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    const value = res.result?.result?.value ?? res.result?.exceptionDetails?.exception?.description;
    const cur = diff ? parse(value) : null;
    if (diff && cur && prev && typeof cur === "object" && typeof prev === "object") {
      const changed = Object.keys(cur).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(prev[k]));
      console.log(key, i + 1, changed.length ? changed.map((k) => `${k}=${JSON.stringify(cur[k])}`).join(" ") : "-");
      prev = cur;
    } else {
      console.log(key, i + 1, value);
      prev = cur;
    }
  }
  close(); process.exit(0);
} catch (e) { fail(e); }
