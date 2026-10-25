// node render.mjs <Component> '<props JSON>' [out.png]
//
// Render one @decky/ui component with the given props into our QAM panel, in
// memory, with Steam's real components and CSS: no build, no deploy, nothing
// saved. Wrapped in a PanelSectionRow (the QAM row context), placed above the
// list section's heading (below the floating tab pane). It never hides or
// changes anything else. Prints the component's box against the panel's, then the
// guideline audit (audit.js, incl. OVERFLOW), takes a screenshot if asked, and
// always removes the component again. Example (the Update all progress row):
//   node render.mjs ProgressBarWithInfo '{"indeterminate":true,"childrenContainerWidth":"max","sOperationText":"Updating all installations…"}' /tmp/pb.png
import fs from "node:fs";
import path from "node:path";

const [, , component, propsJson = "{}", out] = process.argv;
if (!component) {
  console.error("usage: node render.mjs <Component> '<props JSON>' [out.png]");
  process.exit(2);
}
const props = JSON.parse(propsJson);
const here = path.dirname(new URL(import.meta.url).pathname);
const targets = await (await fetch("http://localhost:18080/json")).json();

async function cdp(title, method, params) {
  const t = targets.find((x) => x.title.includes(title) && x.webSocketDebuggerUrl);
  if (!t) throw new Error(`no target ${title}`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const res = await new Promise((r) => {
    ws.onmessage = (m) => r(JSON.parse(m.data));
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  ws.close();
  return res.result;
}
const evalIn = async (title, expression) => {
  const r = await cdp(title, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "exception");
  return r?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await evalIn(
  "SharedJSContext",
  `window.DFL.Navigation.OpenQuickAccessMenu(999); setTimeout(() => window.DeckyPluginLoader.deckyState.setActivePlugin("WoWDeck"), 500); 1`,
);
await sleep(2500);
const QAM = "QuickAccess_uid2";
try {
  const mounted = await evalIn(
    QAM,
    `(() => {
      const O = window.opener, R = O.SP_REACT, D = O.DFL;
      const C = D[${JSON.stringify(component)}];
      if (!C) return "no component " + ${JSON.stringify(component)};
      const root = document.querySelector(".wowdeck-root");
      if (!root) return "panel not open";
      // In the list's section, right after its heading: the container with the
      // most rows, outside the floating tab pane. Found by structure, because
      // Steam's class names are hashed and Decky's sections use their own.
      const section = [...root.querySelectorAll("div")]
        .filter((e) => !e.closest(".wowdeck-float-pane"))
        .sort((a, b) => b.childElementCount - a.childElementCount)[0];
      if (!section) return "no list section";
      const host = document.createElement("div");
      host.id = "wowdeck-render-probe";
      section.insertBefore(host, section.children[1] ?? null);
      const { createRoot } = D.findModule((m) => m && typeof m.createRoot === "function");
      window.__wowdeckRenderRoot = createRoot(host);
      window.__wowdeckRenderRoot.render(R.createElement(D.PanelSectionRow, null, R.createElement(C, ${JSON.stringify(props)})));
      host.scrollIntoView({ block: "center" });
      return "ok";
    })()`,
  );
  if (mounted !== "ok") throw new Error(mounted);
  await sleep(800);
  console.log(
    await evalIn(
      QAM,
      `(() => {
        const box = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.height)]; };
        const host = document.getElementById("wowdeck-render-probe");
        const panel = document.querySelector(".wowdeck-root");
        const widest = Math.max(...[...host.querySelectorAll("*")].map((e) => e.getBoundingClientRect().right));
        return JSON.stringify({ panel: box(panel), component: box(host), widestRight: Math.round(widest), overflowPx: Math.max(0, Math.round(widest - panel.getBoundingClientRect().right)) });
      })()`,
    ),
  );
  const field = await evalIn("SharedJSContext", "window.DFL.gamepadDialogClasses.Field");
  const audit = fs.readFileSync(path.join(here, "audit.js"), "utf8");
  console.log(await evalIn(QAM, `globalThis.__AUDIT_FIELD_CLASS__=${JSON.stringify(field)};` + audit));
  if (out) {
    const shot = await cdp(QAM, "Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
    console.log("screenshot:", out);
  }
} finally {
  console.log(
    "cleanup:",
    await evalIn(
      QAM,
      `(() => { window.__wowdeckRenderRoot?.unmount(); delete window.__wowdeckRenderRoot; document.getElementById("wowdeck-render-probe")?.remove(); return "removed"; })()`,
    ),
  );
}
process.exit(0);
