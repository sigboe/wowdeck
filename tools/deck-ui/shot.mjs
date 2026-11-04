// node shot.mjs <targetTitleSubstring> <out.png> [--timeout=ms]  - screenshot one Steam CEF target
// A hidden window (the QAM closed) never finishes the capture, so give up after 10 s by default.
import fs from "node:fs";
const args = process.argv.slice(2);
const tArg = args.find((a) => a.startsWith("--timeout="));
const ms = Number(tArg ? tArg.slice(10) : 10000);
const [want, out] = args.filter((a) => !a.startsWith("--"));
import { connect } from "./cdp.mjs";
const { send, close } = await connect(want);
try {
  const res = await send("Page.captureScreenshot", { format: "png" }, ms);
  if (!res?.result?.data) throw new Error("CEF returned no screenshot");
  const bytes = Buffer.from(res.result.data, "base64");
  fs.writeFileSync(out, bytes);
  console.log(`${out} ${bytes.length} bytes`);
} catch (e) {
  console.error(`${e.message}; a hidden window never paints (open the QAM first)`);
  process.exitCode = 1;
} finally {
  close();
}
