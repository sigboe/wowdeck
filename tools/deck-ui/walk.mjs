// node walk.mjs <target> <measure.js> <ArrowUp|ArrowDown|ArrowLeft|ArrowRight ...>  - press each key in turn and print the measurement after it
import fs from "node:fs";
const ALLOWED = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };
const [,, want, file, ...keys] = process.argv;
const expr = fs.readFileSync(file, "utf8");
const targets = await (await fetch("http://localhost:18080/json")).json();
const t = targets.find(t => t.title.includes(want) && t.webSocketDebuggerUrl);
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const send = (method, params) => new Promise(r => { const my = ++id; const h = m => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener("message", h); r(d); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id: my, method, params })); });
for (const key of keys) { if (!(key in ALLOWED)) continue; const code = ALLOWED[key];
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await new Promise(r => setTimeout(r, 350));
  const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  console.log(key.padEnd(10), res.result?.result?.value ?? res.result?.exceptionDetails?.exception?.description); }
ws.close(); process.exit(0);
