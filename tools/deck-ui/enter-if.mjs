// Guarded Enter: only when the focused element matches the CSS selector argv[3].
const [,, want, selector] = process.argv;
const targets = await (await fetch("http://localhost:18080/json")).json();
const t = targets.find(t => t.title.includes(want) && t.webSocketDebuggerUrl);
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const send = (method, params) => new Promise(r => { const my = ++id; const h = m => { const d = JSON.parse(m.data); if (d.id === my) { ws.removeEventListener("message", h); r(d); } }; ws.addEventListener("message", h); ws.send(JSON.stringify({ id: my, method, params })); });
const chk = await send("Runtime.evaluate", { expression: `(()=>{const f=document.querySelector('.gpfocus');return !!f&&f.matches(${JSON.stringify(selector)})})()`, returnByValue: true });
if (chk.result?.result?.value !== true) { console.log("REFUSED: focus does not match", selector); process.exit(3); }
for (const type of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
console.log("entered on", selector); ws.close(); process.exit(0);
