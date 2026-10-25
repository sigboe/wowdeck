// node eval.mjs <targetTitleSubstring> <expression | file.js>  - evaluate in a Steam CEF target (read-only unless the expression changes something)
import fs from "node:fs";
const [,, want, src] = process.argv;
const expr = fs.existsSync(src) ? fs.readFileSync(src, "utf8") : src;
const targets = await (await fetch("http://localhost:18080/json")).json();
const t = targets.find(t => t.title.includes(want) && t.webSocketDebuggerUrl);
if (!t) { console.error("no target", targets.map(t=>t.title)); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
const res = await new Promise(r => { ws.onmessage = m => r(JSON.parse(m.data)); ws.send(JSON.stringify({id:1,method:"Runtime.evaluate",params:{expression:expr,returnByValue:true,awaitPromise:true}})); });
ws.close();
console.log(res.result?.exceptionDetails ? "EXC " + JSON.stringify(res.result.exceptionDetails.exception?.description) : JSON.stringify(res.result?.result?.value, null, 1));
process.exit(0);
