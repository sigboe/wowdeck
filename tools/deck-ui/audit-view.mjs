// node audit-view.mjs <target>  - run audit.js on the view on screen, with Steam's Field
// class looked up from @decky/ui in SharedJSContext (read-only).
import fs from "node:fs";
import path from "node:path";
const [,, want] = process.argv;
const here = path.dirname(new URL(import.meta.url).pathname);
const targets = await (await fetch("http://localhost:18080/json")).json();
async function evalIn(title, expr) {
  const t = targets.find((x) => x.title.includes(title) && x.webSocketDebuggerUrl);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const res = await new Promise((r) => {
    ws.onmessage = (m) => r(JSON.parse(m.data));
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
  });
  ws.close();
  return res.result?.result?.value ?? res.result?.exceptionDetails?.exception?.description;
}
const field = await evalIn("SharedJSContext", "window.DFL.gamepadDialogClasses.Field");
const audit = fs.readFileSync(path.join(here, "audit.js"), "utf8");
console.log(await evalIn(want, `globalThis.__AUDIT_FIELD_CLASS__=${JSON.stringify(field)};` + audit));
process.exit(0);
