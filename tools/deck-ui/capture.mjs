// node capture.mjs [--start a] [--stop b] [--tail 1500] [--out dir] [--film QuickAccess,"Steam Big Picture Mode"] [--max 120000] [--learn]
//
// Record what Steam does between two controller presses, driven by the owner
// on the Deck: press the start button (default A) to begin, the stop button
// (default B) to end, plus --tail ms after it, so what the stop press itself
// does (B closing the keyboard) is in the record. Nothing is installed on the Deck; everything runs over
// the CEF tunnel and is undone at the end (an in-memory trial, README rules).
//
// Records, all stamped with the Deck's clock (Date.now() in each window):
// - every controller button (SteamClient.Input.RegisterForControllerInputMessages);
// - the on-screen keyboard's shown state (SteamUIStore … m_bIsVirtualKeyboardShowing);
// - Big Picture: the QAM BrowserView's bounds every frame, and every SetBounds
//   call on it with its stack (who moves the QAM: Steam or us);
// - the QAM window: size, visibility, the widened classes on its root;
// - windows (CEF targets) opening and closing, e.g. the keyboard's;
// - screencast frames of the --film targets.
// Writes <out>/events.jsonl, <out>/summary.txt and <out>/frames/<target>/*.jpg.
// --learn only prints button codes until Ctrl-C (to map a new button name).
import fs from "node:fs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
// SteamClient button codes, learned on the Deck with --learn and pad.sh (2026-10-21).
const BUTTONS = { a: 0, b: 1, x: 2, lb: 30, rb: 31 };
const startCode = Number(BUTTONS[opt("start", "a")] ?? opt("start", "a"));
const stopCode = Number(BUTTONS[opt("stop", "b")] ?? opt("stop", "b"));
const out = opt("out", `capture-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const film = opt("film", "QuickAccess").split(",").filter(Boolean);
const maxMs = Number(opt("max", "120000"));
const tailMs = Number(opt("tail", "1500"));
const learn = args.includes("--learn");
const HOST = "http://localhost:18080";

/** One CDP connection to a target, with a binding the page calls to report events. */
async function connect(target, onEvent) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  const frames = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    } else if (d.method === "Runtime.bindingCalled" && d.params.name === "__capEvt") {
      try {
        onEvent({ target: target.title, ...JSON.parse(d.params.payload) });
      } catch {}
    } else if (d.method === "Page.screencastFrame") {
      frames.push({ t: Date.now(), data: d.params.data });
      ws.send(JSON.stringify({ id: ++id, method: "Page.screencastFrameAck", params: { sessionId: d.params.sessionId } }));
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const my = ++id;
      pending.set(my, r);
      ws.send(JSON.stringify({ id: my, method, params }));
    });
  await send("Runtime.enable");
  await send("Runtime.addBinding", { name: "__capEvt" });
  const evaluate = (expression) => send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return { ws, send, evaluate, frames, title: target.title };
}

const targets = async () => {
  let res;
  try {
    res = await fetch(`${HOST}/json`);
  } catch {
    console.error(`no CEF at ${HOST}: start the tunnel (README "Connect")`);
    process.exit(2);
  }
  return (await res.json()).filter((t) => t.webSocketDebuggerUrl);
};
const find = (list, want) => list.find((t) => t.title.includes(want));

// ---- page-side scripts (each guards on window.__capture and undoes itself in stop()) ----

const SHARED_JS = `(() => {
  if (window.__capture) window.__capture.stop();
  const emit = (e) => window.__capEvt(JSON.stringify({ t: Date.now(), ...e }));
  const reg = SteamClient.Input.RegisterForControllerInputMessages((c, code, pressed) => emit({ k: "button", code, pressed }));
  const osk = () => window.SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance?.m_VirtualKeyboardManager?.m_bIsVirtualKeyboardShowing?.m_currentValue;
  let last = osk();
  emit({ k: "osk", v: last });
  const timer = setInterval(() => { const v = osk(); if (v !== last) { last = v; emit({ k: "osk", v }); } }, 8);
  window.__capture = { now() { emit({ k: "osk", v: osk() }); }, stop() { reg?.unregister?.(); clearInterval(timer); delete window.__capture; } };
  return "ok";
})()`;

const BIG_PICTURE = `(() => {
  if (window.__capture) window.__capture.stop();
  const emit = (e) => window.__capEvt(JSON.stringify({ t: Date.now(), ...e }));
  const browserOf = (el) => {
    for (const k of Object.keys(el)) {
      if (!k.startsWith("__reactFiber$")) continue;
      for (let n = el[k], d = 0; d < 12 && n; d++, n = n.return) {
        const p = n.memoizedProps;
        if (p && p.browser && typeof p.browser.SetBounds === "function") return { browser: p.browser, fiber: n };
      }
    }
    return null;
  };
  const rest = document.getElementById("MainNavMenu-Rest");
  let found = null;
  for (const el of (rest ?? document).querySelectorAll("*")) { const f = browserOf(el); if (f) { found = f; if (f.browser.GetBounds().width > 0) break; } }
  if (!found) { emit({ k: "error", v: "no QAM view" }); return "no view"; }
  const view = found.browser;
  // The placeholder's own props and state: primitives only, to spot what Steam's layout reads.
  const flat = (o) => { const r = {}; if (typeof o !== "object") return o ?? null; for (const [k, v] of Object.entries(o ?? {})) if (v === null || ["string", "number", "boolean"].includes(typeof v)) r[k] = v; return r; };
  const snapshot = () => { const out = {}; for (let n = found.fiber, d = 0; d < 8 && n; d++, n = n.return) out[d + ":" + (n.type?.displayName || n.type?.name || typeof n.type)] = { props: flat(n.memoizedProps), state: flat(n.memoizedState?.memoizedState ?? n.memoizedState) }; return JSON.stringify(out); };
  let lastSnap = snapshot();
  emit({ k: "qamProps", v: JSON.parse(lastSnap) });
  const original = view.SetBounds, own = Object.prototype.hasOwnProperty.call(view, "SetBounds");
  const wrapper = function (...a) {
    emit({ k: "setBounds", v: a, stack: new Error().stack.split("\\n").slice(2, 9).map((s) => s.trim()) });
    return original.apply(this, a);
  };
  view.SetBounds = wrapper;
  let lastB = "", raf = 0;
  const frame = () => {
    const b = view.GetBounds(), s = JSON.stringify(b);
    if (s !== lastB) { lastB = s; emit({ k: "bounds", v: b }); }
    const snap = snapshot();
    if (snap !== lastSnap) { lastSnap = snap; emit({ k: "qamProps", v: JSON.parse(snap) }); }
    raf = requestAnimationFrame(frame);
  };
  frame();
  window.__capture = { stop() { cancelAnimationFrame(raf); if (view.SetBounds === wrapper) { if (own) view.SetBounds = original; else delete view.SetBounds; } delete window.__capture; } };
  return "ok";
})()`;

const QAM_WINDOW = `(() => {
  if (window.__capture) window.__capture.stop();
  const emit = (e) => window.__capEvt(JSON.stringify({ t: Date.now(), ...e }));
  const geo = () => JSON.stringify({ w: innerWidth, h: innerHeight, x: screenX, y: screenY, hidden: document.hidden,
    expanded: !!document.querySelector(".QAMFriendExpanded"), focus: document.activeElement?.tagName + "." + String(document.activeElement?.className).slice(0, 40) });
  let last = "";
  const tick = () => { const g = geo(); if (g !== last) { last = g; emit({ k: "qamWindow", v: JSON.parse(g) }); } };
  tick();
  const timer = setInterval(tick, 8);
  addEventListener("resize", tick);
  document.addEventListener("visibilitychange", tick);
  window.__capture = { stop() { clearInterval(timer); removeEventListener("resize", tick); document.removeEventListener("visibilitychange", tick); delete window.__capture; } };
  return "ok";
})()`;

// ---- run ----

const events = [];
const record = (e) => events.push(e);
let recording = false;
let stopping = false;
let done;
const finished = new Promise((r) => (done = r));

const initial = await targets();
const shared = await connect(find(initial, "SharedJSContext"), (e) => {
  if (learn) {
    if (e.k === "button" && e.pressed) console.log("button code", e.code);
    return;
  }
  if (e.k === "button" && e.pressed && e.code === startCode && !recording) {
    recording = true;
    void begin(e.t);
  } else if (e.k === "button" && e.pressed && e.code === stopCode && recording && !stopping) {
    stopping = true;
    record({ ...e, k: "stop" });
    setTimeout(done, tailMs);
    return;
  }
  if (recording) record(e);
});
console.log("SharedJSContext", (await shared.evaluate(SHARED_JS)).result?.result?.value);
if (learn) {
  console.log("press buttons on the Deck; Ctrl-C to quit");
  process.on("SIGINT", async () => {
    await shared.evaluate("window.__capture?.stop()");
    process.exit(0);
  });
  await new Promise(() => {});
}
// Armed before the start press, so the first frames after it are not lost
// to injection time; only events after the start are kept.
const watched = [];
const pageEvent = (e) => {
  if (recording) record(e);
};
const armed = await targets();
for (const [want, script] of [
  ["Steam Big Picture Mode", BIG_PICTURE],
  ["QuickAccess", QAM_WINDOW],
]) {
  const t = find(armed, want);
  if (!t) continue;
  const c = await connect(t, pageEvent);
  console.log(t.title, (await c.evaluate(script)).result?.result?.value);
  if (film.some((name) => t.title.includes(name))) {
    await c.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 854, maxHeight: 534, everyNthFrame: 1 });
  }
  watched.push(c);
}
console.log(`ready: press ${opt("start", "a")} on the Deck to start, ${opt("stop", "b")} to stop (max ${maxMs / 1000}s after start)`);

let poll;
let startT = 0;
async function begin(t0) {
  console.log("recording…");
  startT = t0;
  record({ t: t0, k: "start" });
  void shared.evaluate("window.__capture?.now()");
  const list = await targets();
  let known = new Set(list.map((t) => t.id));
  const titles = new Map(list.map((t) => [t.id, t.title]));
  poll = setInterval(async () => {
    try {
      const now = await targets();
      const ids = new Set(now.map((t) => t.id));
      for (const t of now) if (!known.has(t.id)) record({ t: Date.now(), k: "windowOpened", v: t.title });
      for (const id of known) if (!ids.has(id)) record({ t: Date.now(), k: "windowClosed", v: titles.get(id) });
      for (const t of now) titles.set(t.id, t.title);
      known = ids;
    } catch {}
  }, 200);
  setTimeout(done, maxMs);
}

const stop = async () => {
  clearInterval(poll);
  for (const c of [shared, ...watched]) {
    try {
      await c.send("Page.stopScreencast");
    } catch {}
    try {
      await c.evaluate("window.__capture?.stop()");
    } catch {}
  }
};
process.on("SIGINT", async () => {
  await stop();
  process.exit(1);
});

await finished;
await stop();
console.log("stopped");

fs.mkdirSync(out, { recursive: true });
events.sort((a, b) => a.t - b.t);
const t0 = events[0]?.t ?? 0;
fs.writeFileSync(`${out}/events.jsonl`, events.map((e) => JSON.stringify({ ...e, ms: e.t - t0 })).join("\n") + "\n");
for (const c of watched) {
  const frames = c.frames.filter((f) => f.t >= startT);
  if (!frames.length) continue;
  const dir = `${out}/frames/${c.title.replace(/[^A-Za-z0-9]+/g, "_")}`;
  fs.mkdirSync(dir, { recursive: true });
  frames.forEach((f, i) => fs.writeFileSync(`${dir}/f${String(i).padStart(3, "0")}_${f.t - t0}.jpg`, Buffer.from(f.data, "base64")));
}
const short = (e) => {
  const v = e.k === "setBounds" ? `${JSON.stringify(e.v)} from ${e.stack?.[0] ?? "?"}` : JSON.stringify(e.v ?? e.code ?? "");
  return `${String(e.t - t0).padStart(6)} ms  ${e.k.padEnd(12)} ${v.slice(0, 160)}`;
};
const summary = events.filter((e) => e.k !== "qamProps" || e === events.find((x) => x.k === "qamProps")).map(short).join("\n");
fs.writeFileSync(`${out}/summary.txt`, summary + "\n");
console.log(summary.split("\n").slice(0, 80).join("\n"));
console.log(`\n${events.length} events, frames: ${watched.map((c) => `${c.title} ${c.frames.filter((f) => f.t >= startT).length}`).join(", ")} -> ${out}`);
process.exit(0);
