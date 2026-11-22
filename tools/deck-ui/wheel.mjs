// wheel.mjs <titleSubstr> <count> [deltaY] — dispatch real CDP mouse-wheel events at the screen center
import { connect, fail } from "./cdp.mjs";

const [,, want, countS, deltaS] = process.argv;
try {
  const { send, close } = await connect(want);
  const dims = await send("Runtime.evaluate", { expression: "JSON.stringify({w: innerWidth, h: innerHeight})", returnByValue: true });
  const { w, h } = JSON.parse(dims.result.result.value);
  for (let i = 0; i < Number(countS || 3); i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(w * 0.6), y: Math.round(h * 0.5), deltaX: 0, deltaY: Number(deltaS ?? -120) });
    await new Promise(r => setTimeout(r, 60));
  }
  close(); process.exit(0);
} catch (e) { fail(e); }
