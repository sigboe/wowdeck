// node shot.mjs <targetTitleSubstring> <out.png>  - screenshot one Steam CEF target
import fs from "node:fs";
const [,, want, out] = process.argv;
const targets = await (await fetch("http://localhost:18080/json")).json();
const t = targets.find(t => t.title.includes(want) && t.webSocketDebuggerUrl);
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
const res = await new Promise(r => { ws.onmessage = m => r(JSON.parse(m.data)); ws.send(JSON.stringify({id:1,method:"Page.captureScreenshot",params:{format:"png"}})); });
fs.writeFileSync(out, Buffer.from(res.result.data, "base64"));
ws.close(); process.exit(0);
