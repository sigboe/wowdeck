// node state.mjs [--pages]  - one compact line of the Deck UI state an agent needs first
import { targets, evalIn } from "./cdp.mjs";

const wantPages = process.argv.includes("--pages");
const list = await targets();

const shared = await evalIn(
  "SharedJSContext",
  `JSON.stringify({route:location.pathname,plugin:window.DeckyPluginLoader?.deckyState?._activePlugin?.name||null})`,
).then(JSON.parse);

const qam = await evalIn(
  "QuickAccess_uid2",
  `JSON.stringify({open:!!document.querySelector('.gpfocus'),focus:(document.querySelector('.gpfocus')||{}).textContent?.trim().slice(0,40)||null,w:innerWidth,h:innerHeight})`,
).then(JSON.parse);

const parts = [
  `pages=${list.length}`,
  `route=${shared.route}`,
  `plugin=${shared.plugin ?? "-"}`,
  `qam=${qam.open ? "focused" : "closed"}`,
  qam.open ? `focus=${JSON.stringify(qam.focus ?? "")}` : null,
  `view=${qam.w}x${qam.h}`,
].filter(Boolean);
console.log(parts.join(" "));
if (wantPages) console.log(list.map((t) => t.title).join("\n"));
