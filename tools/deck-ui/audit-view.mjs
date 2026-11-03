// node audit-view.mjs <target> [--brief]  - run audit.js on the view on screen, with Steam's Field
// class looked up from @decky/ui in SharedJSContext (read-only). --brief prints one summary line.
import fs from "node:fs";
import path from "node:path";
import { evalIn } from "./cdp.mjs";

const args = process.argv.slice(2).filter((a) => a !== "--brief");
const brief = process.argv.includes("--brief");
const want = args[0];
const here = path.dirname(new URL(import.meta.url).pathname);

const field = await evalIn("SharedJSContext", "window.DFL.gamepadDialogClasses.Field");
const audit = fs.readFileSync(path.join(here, "audit.js"), "utf8");
const result = await evalIn(
  want,
  `globalThis.__AUDIT_FIELD_CLASS__=${JSON.stringify(field)};` + audit,
);

// audit.js returns JSON text; parse it so the summary and the compact form work.
const data = typeof result === "string" ? JSON.parse(result) : result;
if (brief) {
  const rules = [...new Set((data.issues ?? []).map((i) => i.rule))];
  console.log(
    `issues=${data.issues?.length ?? 0} rules=${rules.join(",") || "-"} focusables=${data.focusables ?? "?"}`,
  );
} else {
  console.log(JSON.stringify(data));
}
process.exit(0);
