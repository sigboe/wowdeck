// Guarded Enter: only when the focused element matches the CSS selector argv[3].
import { connect, fail } from "./cdp.mjs";

const [,, want, selector] = process.argv;
try {
  const { send, close } = await connect(want);
  const chk = await send("Runtime.evaluate", { expression: `(()=>{const f=document.querySelector('.gpfocus');return !!f&&f.matches(${JSON.stringify(selector)})})()`, returnByValue: true });
  if (chk.result?.result?.value !== true) { console.log("REFUSED: focus does not match", selector); process.exit(3); }
  for (const type of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  console.log("entered on", selector);
  close(); process.exit(0);
} catch (e) { fail(e); }
