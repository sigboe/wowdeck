// node seek.mjs <target> <label> [--exact] [--enter] [--list] [--reset] [--press]
//                  [--dir=down|up|left|right] [--max=40] [--cross=right|left] [--no-recover]
//
// Default: jump focus straight to the matching focusable through Steam's navigation
// tree. That is one call, no presses, and it crosses text fields and columns that
// arrow keys cannot. --press walks there with real key presses instead (for testing
// the navigation itself); it checks the label after every press and stops on the match.
import { connect, evalIn } from "./cdp.mjs";
import { elementLabel } from "./diagnostics.mjs";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const f = argv.find((a) => a.startsWith(`--${name}=`));
  return f ? f.slice(name.length + 3) : dflt;
};
const has = (name) => argv.includes(`--${name}`);
const [want, query] = argv.filter((a) => !a.startsWith("--"));
if (!want || !query) {
  console.error("usage: seek.mjs <target> <label> [--exact] [--enter] [--list] [--reset] [--press] [--dir=down]");
  process.exit(2);
}

const exact = has("exact");
const list = has("list");
const pressMode = has("press");
const enter = has("enter");
const dir = flag("dir", "down");
const max = Number(flag("max", "40"));
const settle = Number(flag("settle", "500"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (has("reset")) {
  // Open the QAM on our panel. Separate round trips: setting the plugin before the QAM
  // is up leaves the panel focusless.
  await evalIn("SharedJSContext", `window.DFL.Navigation.CloseSideMenus(), 'closed'`);
  await sleep(500);
  await evalIn("SharedJSContext", `window.DFL.Navigation.OpenQuickAccessMenu(999), 'open'`);
  await sleep(1500);
  await evalIn("SharedJSContext", `window.DeckyPluginLoader.deckyState.setActivePlugin('WoWDeck'), 'plugin'`);
  await sleep(1500);
}

const focusLabel = async () =>
  evalIn(want, `(() => { const f = document.querySelector('.gpfocus');
    return f ? (f.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80) : null; })()`);

const press = async (name) => {
  const KEYS = { down: "ArrowDown", up: "ArrowUp", left: "ArrowLeft", right: "ArrowRight", enter: "Enter" };
  const CODES = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Enter: 13 };
  const key = KEYS[name] ?? KEYS[dir];
  const { send, close } = await connect(want);
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: CODES[key], nativeVirtualKeyCode: CODES[key] });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: CODES[key], nativeVirtualKeyCode: CODES[key] });
  close();
  await sleep(settle);
};

const jump = async () =>
  JSON.parse(
    await evalIn(
      "SharedJSContext",
      `(() => {
        const q = ${JSON.stringify(query.toLowerCase())};
        const exact = ${exact};
        const tree = window.DFL.getFocusNavController().GetActiveNavTree();
        if (!tree || !tree.Root) return JSON.stringify({ error: 'no active nav tree' });
        const all = [];
        const walk = (n) => { all.push(n); (n.m_rgChildren || []).forEach(walk); };
        walk(tree.Root);
        const label = n => (${elementLabel})(n.m_element);
        // The tree holds a wrapper and an inner node for the same row; collapse them by
        // label and position so a search reports each target once.
        const items = [];
        for (const n of all) {
          const e = n.m_element;
          if (!e) continue;
          const r = e.getBoundingClientRect();
          if (!r || r.width <= 0 || r.height <= 0) continue;
          const l = label(n);
          if (!l) continue;
          const rect = { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom) };
          const overlaps = (a, b) =>
            !(a.right < b.x || b.right < a.x || a.bottom < b.y || b.bottom < a.y);
          // A wrapper and its inner row overlap; keep the first one seen.
          if (items.some((k) => k.l === l && overlaps(k.rect, rect))) continue;
          items.push({ n, l, rect });
        }
        const hits = items.filter((x) => exact ? x.l.toLowerCase() === q : x.l.toLowerCase().includes(q));
        if (!hits.length) return JSON.stringify({ found: false, near: items.slice(0, 6).map((x) => x.l.slice(0, 40)) });
        if (${list}) return JSON.stringify({ list: hits.slice(0, 20).map((x) => x.l.slice(0, 60)) });
        // Prefer an exact label, then one that starts with the query, then the shortest
        // label: containers carry the text of every child and would otherwise win.
        const score = (x) => {
          const l = x.l.toLowerCase();
          return (l === q ? 1000 : l.startsWith(q) ? 500 : 0) - x.l.length;
        };
        hits.sort((a, b) => score(b) - score(a));
        const pick = hits[0];
        const took = pick.n.BTakeFocus();
        return JSON.stringify({ found: true, label: pick.l.slice(0, 80), took: !!took, matches: hits.length });
      })()`,
    ),
  );

if (list) {
  const r = await jump();
  console.log(r.list ? r.list.map((l) => `- ${l}`).join("\n") : `no match for "${query}"`);
  process.exit(r.list ? 0 : 1);
}

if (!pressMode) {
  const r = await jump();
  if (r.found && r.took) {
    await sleep(300);
    const focused = await focusLabel();
    if (enter) await press("enter");
    console.log(
      enter
        ? `pressed Enter on "${focused ?? r.label}" (jump)`
        : `found "${focused ?? r.label}" (jump${r.matches > 1 ? `, ${r.matches} matches` : ""})`,
    );
    process.exit(0);
  }
  if (r.found) {
    console.log(`could not focus "${r.label}"`);
    process.exit(1);
  }
  console.log(`no match for "${query}"${r.near?.length ? `; focusables here: ${r.near.join(" | ")}` : ""}`);
  process.exit(1);
}

// --press: real key presses, verified after each one.
let focused = await focusLabel();
const label = (s) => (s == null ? "nothing" : `"${s}"`);
const matches = (s) => s != null && (exact ? s.toLowerCase() === query.toLowerCase() : s.toLowerCase().includes(query.toLowerCase()));
if (matches(focused)) {
  if (enter) await press("enter");
  console.log(`${enter ? "pressed Enter on" : "found"} "${focused}" already focused`);
  process.exit(0);
}
let presses = 0;
let stuck = 0;
let prev = focused;
const tried = new Set();
while (presses < max) {
  if (stuck >= 2) {
    const next = [flag("cross", null), "right", "left"].find((d) => d && !tried.has(d));
    if (has("no-recover") || !next) break;
    tried.add(next);
    await press(next);
    presses++;
    focused = await focusLabel();
    stuck = 0;
    prev = focused;
    if (matches(focused)) break;
    continue;
  }
  await press(dir);
  presses++;
  focused = await focusLabel();
  if (focused === prev) stuck++;
  else { stuck = 0; prev = focused; }
  if (matches(focused)) break;
}
if (!matches(focused)) {
  console.log(`no match after ${presses} presses, focus=${label(focused)}`);
  process.exit(1);
}
if (enter) await press("enter");
console.log(`${enter ? "pressed Enter on" : "found"} ${label(focused)} after ${presses} presses (${dir})`);
process.exit(0);
