// node profile.mjs <title> <ms> <triggerExprFile> <out.json>
import fs from "node:fs";
import { connect, fail } from "./cdp.mjs";

const [,, want, msS, trig, out] = process.argv;
try {
  const { send, close } = await connect(want);
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
  close(); process.exit(0);
} catch (e) { fail(e); }
