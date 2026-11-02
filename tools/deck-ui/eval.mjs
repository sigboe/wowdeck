// node eval.mjs <targetTitleSubstring> <expression | file.js> [-p]  - evaluate in a Steam CEF target (read-only unless the expression changes something)
// Output is one compact line: a string result prints raw, anything else as JSON (-p indents).
import fs from "node:fs";
const args = process.argv.slice(2).filter((a) => a !== "-p");
const pretty = process.argv.includes("-p");
const [want, src] = args;
const expr = fs.existsSync(src) ? fs.readFileSync(src, "utf8") : src;
import { evalIn, print } from "./cdp.mjs";
try {
  print(await evalIn(want, expr), pretty);
} catch (e) {
  console.error(`EXC ${e.message.split("\n")[0]}`);
  process.exitCode = 1;
}
