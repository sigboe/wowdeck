// node step.mjs <title> <ArrowUp|ArrowDown> <count> <delayMs> <evalFile> [--diff]  (navigation keys only)
// --diff prints only the fields that changed since the previous press.
import fs from "node:fs";
const ALLOWED = { ArrowUp: 38, ArrowDown: 40 };
const args = process.argv.slice(2).filter((a) => a !== "--diff");
const diff = process.argv.includes("--diff");
const [want, key, countS, delayS, file] = args;
if (!(key in ALLOWED)) process.exit(2);
const expr = fs.readFileSync(file, "utf8");
const targets = await (await fetch("http://localhost:18080/json")).json();
const t = targets.find((t) => t.title.includes(want) && t.webSocketDebuggerUrl);
if (!t) { console.error("no target", targets.map((t) => t.title)); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0;
const send = (method, params) => new Promise(r => { const my = ++id; const h = m => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener("message", h); r(d); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id: my, method, params })); });
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
ws.close(); process.exit(0);
