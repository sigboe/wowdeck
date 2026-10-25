// node cast.mjs <title> <ms> <outDir> [triggerTitle triggerExprFile]
import fs from "node:fs";
const [,, want, msS, out, trigTitle, trigFile] = process.argv;
const targets = await (await fetch("http://localhost:18080/json")).json();
const t = targets.find(t => t.title.includes(want) && t.webSocketDebuggerUrl);
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
const send = (method, params) => new Promise(r => { const my = ++id; pending.set(my, r); ws.send(JSON.stringify({ id: my, method, params })); });
const frames = []; const t0 = Date.now();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === "Page.screencastFrame") { frames.push({ t: Date.now() - t0, data: d.params.data }); ws.send(JSON.stringify({ id: ++id, method: "Page.screencastFrameAck", params: { sessionId: d.params.sessionId } })); } };
await send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 750, maxHeight: 422, everyNthFrame: 1 });
await new Promise(r => setTimeout(r, 300));
if (trigTitle) {
  const tt = targets.find(x => x.title.includes(trigTitle) && x.webSocketDebuggerUrl);
  const w2 = new WebSocket(tt.webSocketDebuggerUrl); await new Promise(r => w2.onopen = r);
  w2.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: fs.readFileSync(trigFile, "utf8"), returnByValue: true } }));
  console.log("triggered at", Date.now() - t0);
}
await new Promise(r => setTimeout(r, Number(msS)));
await send("Page.stopScreencast", {});
fs.mkdirSync(out, { recursive: true });
frames.forEach((f, i) => fs.writeFileSync(`${out}/f${String(i).padStart(3, "0")}_${f.t}.jpg`, Buffer.from(f.data, "base64")));
console.log("frames", frames.length, frames.map(f => f.t).join(","));
process.exit(0);
