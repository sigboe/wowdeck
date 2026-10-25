// Navigation-only key sender: node key.mjs <titleSubstr> <ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Escape> <count> <delayMs>
const ALLOWED = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Escape: 27 }; // Escape = B (back/cancel)
const [,, want, key, countS, delayS] = process.argv;
if (!(key in ALLOWED)) { console.error("key not allowed:", key); process.exit(2); }
const targets = await (await fetch("http://localhost:18080/json")).json();
const t = targets.find(t => t.title.includes(want) && t.webSocketDebuggerUrl);
if (!t) { console.error("no target"); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0;
const send = (method, params) => new Promise(r => { const my = ++id; const h = m => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener("message", h); r(d); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id: my, method, params })); });
const code = ALLOWED[key];
for (let i = 0; i < Number(countS || 1); i++) {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await new Promise(r => setTimeout(r, Number(delayS || 400)));
}
ws.close(); process.exit(0);
