// node film.mjs <title> <ms> <outDir> [triggerTitle trigger.js]
import fs from "node:fs";
import { connect, fail } from "./cdp.mjs";

const [,, want, msS, out, trigTitle, trigFile] = process.argv;
try {
  const frames = []; const t0 = Date.now();
  let send = async () => {};
  const conn = await connect(want, {
    onEvent: (d) => {
      if (d.method !== "Page.screencastFrame") return;
      frames.push({ t: Date.now() - t0, data: d.params.data });
      send("Page.screencastFrameAck", { sessionId: d.params.sessionId }).catch(() => {});
    },
  });
  send = conn.send;
  await send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 750, maxHeight: 422, everyNthFrame: 1 });
  await new Promise(r => setTimeout(r, 300));
  if (trigTitle) {
    const trigger = await connect(trigTitle);
    try {
      await trigger.send("Runtime.evaluate", { expression: fs.readFileSync(trigFile, "utf8"), returnByValue: true });
    } finally { trigger.close(); }
    console.log("triggered at", Date.now() - t0);
  }
  await new Promise(r => setTimeout(r, Number(msS)));
  await send("Page.stopScreencast", {});
  conn.close();
  fs.mkdirSync(out, { recursive: true });
  frames.forEach((f, i) => fs.writeFileSync(`${out}/f${String(i).padStart(3, "0")}_${f.t}.jpg`, Buffer.from(f.data, "base64")));
  console.log("frames", frames.length, frames.map(f => f.t).join(","));
  process.exit(0);
} catch (e) { fail(e); }
