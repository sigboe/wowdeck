// wheel.mjs <titleSubstr> <count> <deltaY> — dispatch real CDP mouse-wheel events at the screen center
const [,, want, countS, deltaS] = process.argv;
const targets = await (await fetch("http://localhost:18080/json")).json();
const t = targets.find(t => t.title.includes(want) && t.webSocketDebuggerUrl);
if (!t) { console.error("no target"); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0;
const send = (method, params) => new Promise(r => { const my = ++id; const h = m => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener("message", h); r(d); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id: my, method, params })); });
const dims = await send("Runtime.evaluate", { expression: "JSON.stringify({w: innerWidth, h: innerHeight})", returnByValue: true });
const { w, h } = JSON.parse(dims.result.result.value);
for (let i = 0; i < Number(countS || 3); i++) {
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(w * 0.6), y: Math.round(h * 0.5), deltaX: 0, deltaY: Number(deltaS ?? -120) });
  await new Promise(r => setTimeout(r, 60));
}
ws.close(); process.exit(0);
