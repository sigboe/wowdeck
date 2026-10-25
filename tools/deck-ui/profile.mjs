// node prof.mjs <title> <ms> <triggerExprFile> <out.json>
import fs from "node:fs";
const [,, want, msS, trig, out] = process.argv;
const targets = await (await fetch("http://localhost:18080/json")).json();
const t = targets.find(t => t.title.includes(want) && t.webSocketDebuggerUrl);
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params) => new Promise(r => { const my = ++id; pending.set(my, r); ws.send(JSON.stringify({ id: my, method, params })); });
await send("Profiler.enable", {}); await send("Profiler.setSamplingInterval", { interval: 200 });
await send("Profiler.start", {});
await send("Runtime.evaluate", { expression: fs.readFileSync(trig, "utf8") });
await new Promise(r => setTimeout(r, Number(msS)));
const res = await send("Profiler.stop", {});
fs.writeFileSync(out, JSON.stringify(res.result.profile));
const p = res.result.profile; const self = new Map(); const byId = new Map(p.nodes.map(n => [n.id, n]));
const dt = {}; p.samples.forEach((s, i) => { dt[s] = (dt[s] || 0) + (p.timeDeltas[i] || 0); });
for (const n of p.nodes) { const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop().split("?")[0]}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[n.id] || 0)); }
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log("total ms", (total / 1000).toFixed(0));
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log((v / 1000).toFixed(1).padStart(7), k));
// per-url totals
const byUrl = new Map(); for (const n of p.nodes) { const u = n.callFrame.url.split("/").pop().split("?")[0] || "(native)"; byUrl.set(u, (byUrl.get(u) || 0) + (dt[n.id] || 0)); }
console.log("--- by script"); [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, v]) => console.log((v / 1000).toFixed(1).padStart(7), k));
process.exit(0);
