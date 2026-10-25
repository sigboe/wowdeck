// node step.mjs <title> <ArrowUp|ArrowDown> <count> <delayMs> <evalFile>  (navigation keys only)
import fs from "node:fs";
const ALLOWED = { ArrowUp: 38, ArrowDown: 40 };
const [,, want, key, countS, delayS, file] = process.argv;
if (!(key in ALLOWED)) process.exit(2);
const expr = fs.readFileSync(file, "utf8");
const targets = await (await fetch("http://localhost:18080/json")).json();
const t = targets.find(t => t.title.includes(want) && t.webSocketDebuggerUrl);
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0;
const send = (method, params) => new Promise(r => { const my = ++id; const h = m => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener("message", h); r(d); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id: my, method, params })); });
const code = ALLOWED[key];
for (let i = 0; i < Number(countS); i++) {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await new Promise(r => setTimeout(r, Number(delayS)));
  const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  console.log(key, i + 1, res.result?.result?.value ?? res.result?.exceptionDetails?.exception?.description);
}
ws.close(); process.exit(0);
