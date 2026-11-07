// node deck.mjs <step…>                       one step, e.g. `deck.mjs rpc system.getStatus`
// node deck.mjs run '<step>; <step>; …'       a run of steps in one call (or `run -f file`, `run -` for stdin)
// node deck.mjs up [--engine] [--no-build] [--no-guard] [--reload] [--dry-run]   wake, tunnel, build, back up, deploy, reload
// node deck.mjs down                          restore what `up` changed (autoUpdate)
//
// One entry point for a Deck test, so a test takes a few calls instead of a hundred:
// every action step reports what it changed (focus, active nav tree, plugin tab, route, panel)
// once the UI settles, `wait`/`expect` replace sleeps and re-checks, and one virtual
// pad lives through the whole run. `node deck.mjs help` lists the steps.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connect, evalIn } from "./cdp.mjs";
import { reactProbe, uiDiagnostics, checkMethods, redact, scrub } from "./diagnostics.mjs";
import { createConnection, SSH_OPTIONS } from "./connection.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PORT = process.env.DECK_UI_PORT || "18080";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HELP = `deck.mjs steps (run several: deck.mjs run 'open; wait plugin = WoWDeck; probe tab focus; shot')
  verb@target picks a CEF target by title substring; default QuickAccess_uid2 (change: target <substr>)
  open | close | nav <route>               QAM on our panel | close side menus | DFL.Navigation.Navigate
  press <button…>                          real pad (a b x y lb rb lt rt view menu guide l3 r3 up down left right wait:ms hold:b:ms)
  key <down|up|left|right|back|enter> [n]  CDP key presses
  seek <label> [--enter|--press|--list|--exact]   focus a control by its text (seek.mjs)
  probe <name…>                            print probes: {PROBES}
  wait <probe> <~|=|!~|!=> <text> [--t=ms] poll until true (default 5000 ms); expect = check once
  rpc <method> ['{json}'] [--pick=a.b[].c,d] [--full] [--t=ms]   engine call; rpc --list
  eval <expr|file.js> [--full] [--t=ms]    evaluate in the target (default 10000 ms)
  eval --file=path.js | --stdin           literal JavaScript, no run-tokenizer quote stripping
  shot [out.png] [--max=800] [--clip=css] [--full]   screenshot, longest edge capped at --max px
  diagnose                                compact UI, engine, installation and recent-error snapshot
  methods-check                           local frontend/bridge/contract consistency (no device)
  react <css> [--depth=12]                read-only fiber ancestors and Decky patch markers
  log-mark                                checkpoint plugin logs for this run
  log [n] [regex] [--since=mark]           latest log or lines since checkpoint (max 100)
  log-wait <regex> [--since=mark] [--t=5000]   wait remotely in one SSH call (max 20000 ms)
  reload-frontend [--file=dist/index.js]   in-memory bundle; restore open panel, tab and focus
  audit | tree [--roles=a,b] | state | sleep <ms> | target <substr>
  up [--engine] [--no-build] [--no-guard] [--reload] [--dry-run] | down   deploy and reload | restore autoUpdate
Action steps (open close nav press key seek rpc eval) print what changed once the UI settles.
A failed seek, wait, expect or rpc stops the run with exit 1.`;

// --- environment ---------------------------------------------------------------

function loadEnv() {
  const file = path.join(HERE, "local.env");
  const env = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("DECK"))) };
}
const ENV = loadEnv();
const shellQuote = (s) => "'" + String(s).replaceAll("'", "'\"'\"'") + "'";

class StepError extends Error {}
function fail(msg) {
  throw new StepError(msg);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: opts.binary ? undefined : "utf8", maxBuffer: 1 << 26, ...opts });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: `${r.stderr ?? ""}${r.error ? String(r.error) : ""}` };
}
const connection = createConnection(ENV, run, sleep);
const deckHost = () => connection.host();
const ssh = (script, opts) => connection.ssh(script, opts);
const onPath = (tool) => run("sh", ["-c", `command -v ${tool}`]).code === 0;
// A dev-shell tool, through nix when this shell lacks it.
const tool = (name, pkg = name) => (onPath(name) ? [name] : ["nix", "shell", `nixpkgs#${pkg}`, "-c", name]);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}… (+${s.length - n} chars; --full)` : s);
const show = (v) => (typeof v === "string" ? v : JSON.stringify(v));

// --- probes --------------------------------------------------------------------

const NAV = `const c=window.DFL.getFocusNavController(),t=c.GetActiveNavTree(),e=t&&t.m_lastFocusNode&&t.m_lastFocusNode.m_element;
const txt=(el,n)=>el?(el.innerText||'').trim().replace(/\\s+/g,' ').slice(0,n):null;`;
const LOOK = `(()=>{${NAV}return JSON.stringify({tree:t?t.m_ID:null,focus:txt(e,50),route:location.pathname,
plugin:window.DeckyPluginLoader?.deckyState?._activePlugin?.name??null,
tab:t?.Root?.m_element?.ownerDocument?.querySelector('.wowdeck-tab-selected')?.textContent?.trim()??null})})()`;

const PROBES = {
  focus: { from: "look" },
  tree: { from: "look" },
  route: { from: "look" },
  plugin: { from: "look" },
  modal: { target: "SharedJSContext", expr: `(()=>{${NAV}return /Modal/.test(t?.m_ID||'')?txt(t.m_Root?.m_element,160):'none'})()` },
  text: { target: "SharedJSContext", expr: `(()=>{${NAV}return txt(t?.m_Root?.m_element,400)||''})()` },
  items: {
    target: "SharedJSContext",
    expr: `(()=>{${NAV}const out=[];const walk=n=>{const k=n.m_rgChildren||[];if(!k.length){const l=txt(n.m_element,40);
const r=n.m_element?.getBoundingClientRect();if(l&&r&&r.width>0&&!out.includes(l))out.push(l);}k.forEach(walk)};
if(t?.m_Root)walk(t.m_Root);return out.slice(0,20).join(' | ')})()`,
  },
  tab: { target: "QuickAccess_uid2", expr: `document.querySelector('.wowdeck-tab-selected')?.textContent??'none'` },
  toasts: { target: "notificationtoasts", expr: `document.body.innerText.trim().replace(/\\s+/g,' ').slice(0,200)||'none'` },
};

const look = async () => JSON.parse(await evalIn("SharedJSContext", LOOK));
async function probe(name) {
  const p = PROBES[name] ?? fail(`no probe "${name}"; have: ${Object.keys(PROBES).join(" ")}`);
  if (p.from === "look") return String((await look())[name] ?? "none");
  return String((await evalIn(p.target, p.expr)) ?? "none");
}

// Wait until two reads 200 ms apart agree (at most 3 s), then return the view.
async function settled() {
  await sleep(250);
  let a = await look();
  for (let i = 0; i < 14; i++) {
    await sleep(200);
    const b = await look();
    if (JSON.stringify(a) === JSON.stringify(b)) return b;
    a = b;
  }
  return a;
}
const changes = (before, after) => {
  const d = Object.keys(after).filter((k) => after[k] !== before[k]).map((k) => `${k}=${JSON.stringify(after[k])}`);
  return d.length ? d.join(" ") : "no change";
};

// --- the virtual pad, one per run ----------------------------------------------

class Pad {
  async start() {
    const b64 = fs.readFileSync(path.join(HERE, "pad.py")).toString("base64");
    // The script travels as an argument so stdin stays free for the button lines.
    this.proc = spawn("ssh", [...SSH_OPTIONS, deckHost(),
      `python3 -c "import base64;exec(base64.b64decode('${b64}'))" --settle 3000 --stdin`]);
    this.lines = readline.createInterface({ input: this.proc.stdout })[Symbol.asyncIterator]();
    let err = "";
    this.exited = new Promise((resolve) => this.proc.once("close", resolve));
    this.proc.on("error", (e) => { err += e.message; });
    this.proc.stderr.on("data", (d) => (err += d));
    const first = await this.nextLine(15000);
    if (first.value !== "ready") fail(`pad did not start: ${err.trim().split("\n").pop() || "no output"}`);
  }
  async nextLine(timeout) {
    let timer;
    try {
      return await Promise.race([
        this.lines.next(),
        new Promise((_, reject) => { timer = setTimeout(() => {
          this.proc.kill("SIGKILL");
          reject(new StepError("pad SSH timed out"));
        }, timeout); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async press(buttons) {
    if (!this.proc) await this.start();
    this.proc.stdin.write(`${buttons.join(" ")}\n`);
    const r = await this.nextLine(120000);
    if (r.value !== "ok") fail(`pad: ${r.value ?? "closed"}`);
  }
  async close() {
    if (!this.proc) return;
    this.proc.stdin.end();
    const timer = setTimeout(() => this.proc.kill("SIGKILL"), 5000);
    try { await this.exited; }
    finally { clearTimeout(timer); }
  }
}

// --- engine calls --------------------------------------------------------------

function methods() {
  const src = fs.readFileSync(path.join(ROOT, "backend/src/api/contracts.ts"), "utf8");
  const body = src.split("export interface MethodMap {")[1]?.split("\n}\n")[0] ?? "";
  return [...body.matchAll(/^ {2}"([\w.]+)": \{/gm)].map((m) => m[1]);
}

async function rpc(method, params = {}, ms = 15000) {
  const known = methods();
  if (!known.includes(method)) {
    const near = known.filter((m) => m.includes(method.split(".").pop()) || m.startsWith(method.split(".")[0] + "."));
    fail(`unknown method "${method}" (an unknown name hangs the call)${near.length ? `; near: ${near.slice(0, 8).join(" ")}` : ""}`);
  }
  const r = await evalIn("SharedJSContext", `Promise.race([
    DeckyBackend.call('loader/call_plugin_method','WoWDeck','rpc',${JSON.stringify(method)},${JSON.stringify(params)}),
    new Promise((_,j)=>setTimeout(()=>j(new Error('no answer in ${ms} ms')),${ms}))])`, ms + 1000).catch((e) =>
    fail(`rpc ${method}: ${e.message.split("\n")[0]}`),
  );
  if (r && r.__error) fail(`rpc ${method}: ${r.__error.code}: ${r.__error.message}`);
  return r;
}

function pick(v, paths) {
  const one = (p) => {
    let cur = [v];
    let many = false;
    for (const part of p.split(".")) {
      const arr = part.endsWith("[]");
      const k = arr ? part.slice(0, -2) : part;
      cur = cur.map((x) => (k ? x?.[k] : x));
      if (arr) {
        cur = cur.flatMap((x) => (Array.isArray(x) ? x : []));
        many = true;
      }
    }
    return many ? cur : cur[0];
  };
  const list = paths.split(",");
  return list.length === 1 ? one(list[0]) : Object.fromEntries(list.map((p) => [p, one(p)]));
}

// Bound diagnostics independently of the unbounded escape hatch `eval --full`.
const diagnosticText = (v) => {
  const text = show(scrub(v));
  return text.length > 6000 ? `${text.slice(0, 5970)}… (diagnostic output capped)` : text;
};
function integer(value, min, max, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${name} must be an integer from ${min} to ${max}`);
  return n;
}
function readLogs(options) {
  const config = Buffer.from(JSON.stringify(options)).toString("base64");
  const source = fs.readFileSync(path.join(HERE, "logs.py"), "utf8");
  const result = ssh(`python3 -c ${shellQuote(source)} ${shellQuote(config)}`);
  if (result.code !== 0) fail(`log: ${redact(result.err.trim())}`);
  return JSON.parse(result.out);
}

// --- steps ---------------------------------------------------------------------

const flagOf = (args, name, dflt) => {
  const f = args.find((a) => a.startsWith(`--${name}=`));
  return f ? f.slice(name.length + 3) : dflt;
};
const hasFlag = (args, name) => args.includes(`--${name}`);
const plain = (args) => args.filter((a) => !a.startsWith("--"));

const OPS = {
  "~": (v, t) => v.toLowerCase().includes(t.toLowerCase()),
  "!~": (v, t) => !v.toLowerCase().includes(t.toLowerCase()),
  "=": (v, t) => v === t,
  "!=": (v, t) => v !== t,
};
function condition(args) {
  const [name, op, ...rest] = plain(args);
  if (!OPS[op]) fail(`want: <probe> <~|=|!~|!=> <text>, got "${args.join(" ")}"`);
  return { name, op, text: rest.join(" ") };
}

const KEYCODES = { down: ["ArrowDown", 40], up: ["ArrowUp", 38], left: ["ArrowLeft", 37], right: ["ArrowRight", 39], back: ["Escape", 27], enter: ["Enter", 13] };

function nodeScript(script, args) {
  const r = run(process.execPath, [path.join(HERE, script), ...args]);
  return { ok: r.code === 0, text: (r.out + r.err).trim() };
}

async function shot(target, args) {
  const out = plain(args)[0] ?? path.join(os.tmpdir(), `deck-shot-${process.pid}-${Date.now() % 100000}.png`);
  const max = hasFlag(args, "full") ? Infinity : Number(flagOf(args, "max", "800"));
  const sel = flagOf(args, "clip", null);
  const box = await evalIn(target, `(()=>{const r=${sel ? `document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect()` : "null"};
    return JSON.stringify({x:r?r.x:0,y:r?r.y:0,w:r?r.width:innerWidth,h:r?r.height:innerHeight,dpr:devicePixelRatio})})()`).then(JSON.parse);
  if (!box.w || !box.h) fail(`nothing to capture${sel ? ` at ${sel}` : ""}`);
  const scale = Math.min(1, max / (Math.max(box.w, box.h) * box.dpr));
  const { send, close } = await connect(target);
  let res;
  try {
    res = await Promise.race([
    send("Page.captureScreenshot", { format: "png", clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale } }),
    sleep(10000).then(() => null),
    ]);
  } finally { close(); }
  if (!res?.result?.data) fail("no frame in 10 s; a hidden window never paints (open it first)");
  fs.writeFileSync(out, Buffer.from(res.result.data, "base64"));
  const px = (n) => Math.round(n * scale * box.dpr);
  return `${out} ${px(box.w)}x${px(box.h)}`;
}

class Runner {
  target = "QuickAccess_uid2";
  pad = new Pad();
  logCheckpoint = null;

  // Action steps print what they changed; the rest print their own result.
  // Steps that answer for themselves (seek, rpc, eval) stay quiet when nothing moved.
  async action(fn, quiet = false) {
    const before = await look();
    const said = await fn();
    const moved = changes(before, await settled());
    return [said, quiet && moved === "no change" ? "" : moved].filter(Boolean).join(" → ");
  }

  async step(words) {
    const [head, ...args] = words;
    const [verb, at] = head.split("@");
    const target = at || this.target;
    switch (verb) {
      case "target":
        this.target = args[0] ?? fail("target <title substring>");
        return `target=${this.target}`;
      case "open":
        return this.action(async () => {
          await evalIn("SharedJSContext", `window.DFL.Navigation.CloseSideMenus(),1`);
          await sleep(500);
          await evalIn("SharedJSContext", `window.DFL.Navigation.OpenQuickAccessMenu(999),1`);
          // Setting the plugin before the QAM is up leaves the panel focusless.
          for (let i = 0; i < 20 && (await look()).tree !== "QuickAccess-NA"; i++) await sleep(150);
          await sleep(300);
          await evalIn("SharedJSContext", `window.DeckyPluginLoader.deckyState.setActivePlugin('WoWDeck'),1`);
        });
      case "close":
        return this.action(() => evalIn("SharedJSContext", `window.DFL.Navigation.CloseSideMenus(),1`).then(() => ""));
      case "nav":
        return this.action(() =>
          evalIn("SharedJSContext", `window.DFL.Navigation.Navigate(${JSON.stringify(args[0] ?? fail("nav <route>"))}),1`).then(() => ""),
        );
      case "press":
        if (!args.length) fail("press <button…>");
        return this.action(() => this.pad.press(args).then(() => ""));
      case "key": {
        const [name, n = "1"] = args;
        const [key, code] = KEYCODES[name] ?? fail(`key ${Object.keys(KEYCODES).join("|")} [n]`);
        return this.action(async () => {
          const { send, close } = await connect(target);
          for (let i = 0; i < Number(n); i++) {
            for (const type of ["rawKeyDown", "keyUp"]) {
              await send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
            }
            await sleep(250);
          }
          close();
          return "";
        });
      }
      case "seek":
        return this.action(async () => {
          const r = nodeScript("seek.mjs", [target, ...args]);
          if (!r.ok) fail(r.text);
          return r.text;
        }, true);
      case "probe":
        return (await Promise.all((args.length ? args : ["focus", "tree"]).map(async (n) => `${n}=${JSON.stringify(await probe(n))}`))).join(" ");
      case "wait":
      case "expect": {
        const c = condition(args);
        const until = Date.now() + (verb === "wait" ? Number(flagOf(args, "t", "5000")) : 0);
        for (;;) {
          const v = await probe(c.name);
          if (OPS[c.op](v, c.text)) return `${c.name}=${JSON.stringify(v)}`;
          if (Date.now() >= until) fail(`${verb} ${c.name} ${c.op} ${c.text}: ${c.name}=${JSON.stringify(v)}`);
          await sleep(250);
        }
      }
      case "rpc": {
        if (hasFlag(args, "list")) return methods().join(" ");
        const [method, json] = plain(args);
        if (!method) fail("rpc <method> ['{json}']");
        let params = {};
        try {
          params = json ? JSON.parse(json) : {};
        } catch {
          fail(`rpc params are not JSON: ${json}`);
        }
        return this.action(async () => {
          let v = await rpc(method, params, Number(flagOf(args, "t", "15000")));
          const p = flagOf(args, "pick", null);
          if (p) v = pick(v, p);
          return hasFlag(args, "full") ? show(v) : clip(show(v), 600);
        }, true);
      }
      case "eval": {
        const file = flagOf(args, "file", null);
        const stdin = hasFlag(args, "stdin");
        const src = plain(args).join(" ");
        if (Number(!!file) + Number(stdin) + Number(!!src) !== 1) fail("eval <expr|file.js> or --file=path.js or --stdin");
        const timeout = Number(flagOf(args, "t", 10000));
        if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647) fail("eval --t must be an integer from 1 to 2147483647 milliseconds");
        const expr = stdin ? fs.readFileSync(0, "utf8") : file ? fs.readFileSync(file, "utf8") : fs.existsSync(src) ? fs.readFileSync(src, "utf8") : src;
        return this.action(async () => {
          const v = await evalIn(target, expr, timeout).catch((e) => fail(`eval: ${e.message.split("\n")[0]}`));
          return hasFlag(args, "full") ? show(v) : clip(show(v ?? "undefined"), 1500);
        }, true);
      }
      case "shot": {
        // Default to the window that has focus: the QAM when it is open, else Big Picture.
        const t = at || ((await look()).tree === "QuickAccess-NA" ? "QuickAccess_uid2" : "Steam Big Picture Mode");
        return shot(t, args);
      }
      case "audit":
      case "tree": {
        const r = nodeScript(verb === "audit" ? "audit-view.mjs" : "tree.mjs", [target, ...(verb === "audit" ? ["--brief"] : args)]);
        if (!r.ok) fail(r.text);
        return r.text;
      }
      case "state":
        return Object.entries(await look()).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
      case "methods-check": {
        const frontend = fs.readFileSync(path.join(ROOT, "src/services/backend.ts"), "utf8") +
          fs.readdirSync(path.join(ROOT, "src"), { recursive: true }).filter(f => /\.tsx?$/.test(f)).map(f =>
            fs.readFileSync(path.join(ROOT, "src", f), "utf8")).join("\n");
        const result = checkMethods(frontend, fs.readFileSync(path.join(ROOT, "main.py"), "utf8"), methods());
        if (result.missingBridge.length || result.unknownRpc.length) fail(`methods-check ${show(result)}`);
        return show(result);
      }
      case "react": {
        const selector = plain(args).join(" ") || fail("react <css>");
        const depth = integer(flagOf(args, "depth", 12), 1, 40, "react --depth");
        return diagnosticText(await evalIn(target, `(${reactProbe})(${JSON.stringify(selector)},${depth})`));
      }
      case "log-mark":
        this.logCheckpoint = readLogs({ mode: "mark" });
        return "log checkpoint saved for this run";
      case "log":
      case "log-wait": {
        const since = flagOf(args, "since", null);
        if (since && since !== "mark") fail("log --since=mark is the only supported checkpoint");
        if (since && !this.logCheckpoint) fail("run log-mark before --since=mark in the same run");
        const wait = verb === "log-wait";
        const pattern = wait ? plain(args).join(" ") : plain(args).slice(1).join(" ");
        if (wait && !pattern) fail("log-wait <regex>");
        const lines = integer(wait ? 10 : plain(args)[0] ?? 30, 1, 100, "log lines");
        const timeout = integer(flagOf(args, "t", 5000), 1, 20000, "log --t");
        return diagnosticText(readLogs({ mode: wait ? "wait" : "read", pattern, lines,
          timeout: wait ? timeout : 0, checkpoint: since ? this.logCheckpoint : null }));
      }
      case "diagnose": {
        const attempt = async (fn) => { try { return await fn(); } catch (e) { return { error: e.message.split("\n")[0] }; } };
        const [ui, panel, engine, installations, errors] = await Promise.all([
          attempt(look), attempt(() => evalIn(target, `(${uiDiagnostics})()`)),
          attempt(async () => pick(await rpc("system.getStatus", {}, 3000), "backendVersion,protocolVersion,pid")),
          attempt(async () => {
            const result = await rpc("installations.list", {}, 3000);
            return { count: result.installations.length, active: result.installations.filter(i => i.selected).map(i => ({ id: i.id, gameType: i.gameType })) };
          }),
          attempt(() => readLogs({ mode: "read", pattern: "error|exception|failed", lines: 5 })),
        ]);
        return diagnosticText({ ui, panel, engine, installations, errors });
      }
      case "reload-frontend": {
        const file = path.resolve(ROOT, flagOf(args, "file", "dist/index.js"));
        const bundle = fs.readFileSync(file).toString("base64");
        const before = await look();
        // Import before unloading so a syntax/import error leaves the old frontend intact.
        await evalIn("SharedJSContext", `(async()=>{
          const L=window.DeckyPluginLoader;
          if(L.reloadLock)throw new Error('reload in progress');
          const old=L.plugins.find(p=>p.name==='WoWDeck');
          if(!old)throw new Error('WoWDeck is not loaded');
          const m=await import(${JSON.stringify("data:text/javascript;base64," + bundle)});
          if(typeof m.default!=='function')throw new Error('bundle has no plugin factory');
          if(L.deckyState._activePlugin?.name==='WoWDeck'){
            window.DFL.Navigation.CloseSideMenus();
            L.deckyState.setActivePlugin(null);
            await new Promise(resolve=>setTimeout(resolve,100));
          }
          L.unloadPlugin('WoWDeck',true);
          L.plugins.push({...m.default(),name:'WoWDeck',version:old.version,loadType:old.loadType});
          L.deckyState.setPlugins(L.plugins);
          return true;
        })()`);
        if (before.plugin === "WoWDeck" && before.tree === "QuickAccess-NA") {
          await this.step(["open"]);
          if (before.tab) {
            const current = await probe("tab");
            const tabResult = nodeScript("seek.mjs", [target, current, "--exact"]);
            if (!tabResult.ok) fail(`frontend reloaded; tab restore: ${tabResult.text}`);
            const tabs = ["My Addons", "Get Addons", "Options"];
            const from = tabs.indexOf(current), to = tabs.indexOf(before.tab);
            if (from < 0 || to < 0) fail("frontend reloaded; unknown tab during restore");
            if (from !== to) await this.step([`key@${target}`, to > from ? "right" : "left", String(Math.abs(to - from))]);
            if (await probe("tab") !== before.tab) fail("frontend reloaded; tab restore did not take effect");
          }
          if (before.focus) {
            const focusResult = nodeScript("seek.mjs", [target, before.focus, "--exact"]);
            if (!focusResult.ok) fail(`frontend reloaded; focus restore: ${focusResult.text}`);
          }
        }
        return `frontend reloaded in memory; backend unchanged; ${changes({}, await settled())}`;
      }
      case "sleep":
        await sleep(Number(args[0] ?? 500));
        return "";
      case "up":
        return up(args);
      case "down":
        return down();
      case "help":
        return HELP.replace("{PROBES}", Object.keys(PROBES).join(" "));
      default:
        fail(`unknown step "${verb}"; deck.mjs help lists them`);
    }
  }
}

// --- up / down -----------------------------------------------------------------

const PLUGIN = "/home/deck/homebrew/plugins/wowdeck";
const DATA = "/home/deck/homebrew/data/wowdeck";
const say = (line) => console.log(line);

async function tunnelUp() {
  try {
    const r = await fetch(`http://localhost:${PORT}/json/version`, { signal: AbortSignal.timeout(3000) });
    return (await r.json()).webSocketDebuggerUrl != null;
  } catch {
    return false;
  }
}

async function up(args) {
  // 1. Wake.
  const woke = await connection.up(() => {
    const command = tool("wakeonlan");
    const result = run(command[0], [...command.slice(1), "-i", ENV.DECK_WOL_BROADCAST || "255.255.255.255", ENV.DECK_WOL_MAC], { timeout: 60000, killSignal: "SIGKILL" });
    if (result.code !== 0) fail(`Wake-on-LAN failed: ${result.err.trim()}`);
  });
  say(`ssh: ${deckHost()}${woke ? " (woke by Wake-on-LAN)" : ""}`);

  // 2. Tunnel.
  if (!(await tunnelUp())) {
    const tunnel = run("ssh", [...SSH_OPTIONS, "-f", "-N", "-o", "ExitOnForwardFailure=yes",
      "-L", `${PORT}:localhost:8080`, "-L", "9222:localhost:8080", deckHost()], { timeout: 15000, killSignal: "SIGKILL" });
    if (tunnel.code !== 0) fail(`SSH tunnel: ${tunnel.err.trim()}`);
    await sleep(1000);
    if (!(await tunnelUp())) fail("CEF debugger unreachable: ask the owner to enable Decky → Developer → Allow Remote CEF Debugging");
    say("tunnel: opened");
  }

  // 3. Build.
  const engine = hasFlag(args, "engine");
  if (!hasFlag(args, "no-build")) {
    const make = onPath("make") ? ["make"] : ["nix", "develop", "-c", "make"];
    const r = run(make[0], [...make.slice(1), engine ? "build" : "build-frontend"], { cwd: ROOT });
    if (r.code !== 0) fail(`build failed:\n${(r.out + r.err).trim().split("\n").slice(-30).join("\n")}`);
  }
  const files = [
    { local: path.join(ROOT, "dist/index.js"), remote: `${PLUGIN}/dist/index.js`, name: "index.js" },
    { local: path.join(ROOT, "main.py"), remote: `${PLUGIN}/main.py`, name: "main.py" },
  ];
  if (engine) {
    // The Nix loader path does not exist on SteamOS: point the copy at SteamOS's.
    const copy = path.join(os.tmpdir(), "wowdeck-x86_64");
    fs.copyFileSync(path.join(ROOT, "backend/out/wowdeck-x86_64"), copy);
    const pe = tool("patchelf");
    const r = run(pe[0], [...pe.slice(1), "--set-interpreter", "/lib64/ld-linux-x86-64.so.2", copy]);
    if (r.code !== 0) fail(`patchelf: ${r.err.trim()}`);
    files.push({ local: copy, remote: `${PLUGIN}/bin/wowdeck-x86_64`, name: "engine", engine: true });
  }

  // 4. What differs from the Deck.
  const sha = (f) => {
    const r = run("sha256sum", [f]);
    if (r.code !== 0) fail(`hash ${f}: ${r.err.trim()}`);
    return r.out.split(" ")[0];
  };
  const hashes = (output) => new Map(output.trim().split("\n").map((line) => {
    const [digest, file] = line.split(/\s+/, 2);
    return [file, digest];
  }));
  const remote = ssh(`sha256sum ${files.map((f) => f.remote).join(" ")} 2>/dev/null`).out;
  const beforeHashes = hashes(remote);
  const changed = files.filter((f) => beforeHashes.get(f.remote) !== sha(f.local));
  if (hasFlag(args, "dry-run")) return `up --dry-run: would deploy ${changed.map((f) => f.name).join(" ") || "nothing"}`;
  if (!changed.length && !hasFlag(args, "reload")) return "up: the Deck already runs this build (--reload to reload anyway)";

  // 5. Back up state, logs and every file about to be replaced.
  const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "");
  const backup = `${DATA}/test-backups/${stamp}-${process.pid}`;
  const b = ssh(`set -e; mkdir -p ${backup}; cp ${DATA}/state.json ${backup}/; cp -r /home/deck/homebrew/logs/wowdeck ${backup}/logs;
    ${changed.map((f) => `cp ${f.remote} ${backup}/`).join("; ") || "true"}`);
  if (b.code !== 0) fail(`backup: ${b.err.trim()}`);

  // 6. Guard auto-update: a reload would update newly matched addons within seconds.
  let guard = "";
  if (!hasFlag(args, "no-guard")) {
    const s = await rpc("settings.get").catch((e) => fail(`${e.message} (autoUpdate guard; --no-guard skips it)`));
    if (s.settings.autoUpdate) {
      const saved = ssh(`echo '{"autoUpdate":true}' > ${backup}/guard.json`);
      if (saved.code !== 0) fail(`save autoUpdate guard: ${saved.err.trim()}`);
      await rpc("settings.set", { settings: { autoUpdate: false } });
      guard = " · autoUpdate off until `deck.mjs down`";
    }
  }

  // 7. Deploy in place (scp mangles the path). The running engine is replaced by mv.
  for (const f of changed) {
    if (f.engine) {
      const sent = ssh(`mkdir -p ${DATA}/test-smoke/home ${DATA}/test-smoke/data && cat > ${DATA}/test-smoke/wowdeck-x86_64 && chmod +x ${DATA}/test-smoke/wowdeck-x86_64`,
        { input: fs.readFileSync(f.local), binary: true });
      if (sent.code !== 0) fail(`engine upload: ${String(sent.err).trim()}`);
      const smoke = ssh(`cd ${DATA}/test-smoke && printf '%s\\n' '{"id":1,"method":"system.getStatus","params":{}}' |
        HOME=$PWD/home WOWDECK_CHILD=1 WOWDECK_DATA_DIR=$PWD/data timeout 20 ./wowdeck-x86_64 2>err | grep -m1 '"id":1'; tail -3 err`);
      if (!smoke.out.includes('"result"')) fail(`engine smoke test failed; the live engine is untouched:\n${smoke.out.trim()}`);
      const mv = ssh(`cp ${DATA}/test-smoke/wowdeck-x86_64 ${PLUGIN}/bin/.wowdeck-x86_64.new && mv ${PLUGIN}/bin/.wowdeck-x86_64.new ${f.remote} && rm -rf ${DATA}/test-smoke`);
      if (mv.code !== 0) fail(`engine swap: ${mv.err.trim()}`);
    } else {
      const w = ssh(`cat > ${f.remote}`, { input: fs.readFileSync(f.local) });
      if (w.code !== 0) fail(`deploy ${f.name}: ${w.err.trim()}`);
    }
  }
  const after = changed.length ? ssh(`sha256sum ${changed.map((f) => f.remote).join(" ")}`).out : "";
  const afterHashes = hashes(after);
  const bad = changed.filter((f) => afterHashes.get(f.remote) !== sha(f.local));
  if (bad.length) fail(`deployed ${bad.map((f) => f.name).join(", ")} but the Deck's copy differs`);

  // 8. Reload. An open QAM keeps rendering the old bundle, so close it first.
  const pid = await rpc("system.getStatus", {}, 5000).then((s) => s.pid).catch(() => null);
  await evalIn("SharedJSContext", `window.DFL.Navigation.CloseSideMenus(),1`);
  await evalIn("SharedJSContext", `DeckyBackend.call("loader/reload_plugin","WoWDeck").then(()=>1)`).catch((e) =>
    fail(`reload: ${e.message.split("\n")[0]}; backup in ${backup}; run deck down to restore autoUpdate`),
  );
  let status = null;
  for (let i = 0; i < 40 && !status; i++) {
    await sleep(500);
    const loaded = await evalIn("SharedJSContext", `!!window.DeckyPluginLoader?.plugins?.some(p=>p.name==='WoWDeck')`).catch(() => false);
    if (loaded) status = await rpc("system.getStatus", {}, 3000).catch(() => null);
  }
  if (!status) fail(`reload: WoWDeck did not answer in 20 s; backup in ${backup}; journalctl -u plugin_loader`);
  const restarted = pid && status.pid !== pid ? `, engine pid ${pid}→${status.pid}` : status.pid === pid ? ", engine pid unchanged" : "";
  return `up: deployed ${changed.map((f) => f.name).join(" ") || "nothing"} · backup ${backup}${guard} · reloaded ${status.backendVersion}${restarted}`;
}

async function down() {
  const result = ssh(`f=$(ls -t ${DATA}/test-backups/*/guard.json 2>/dev/null | head -1); [ -n "$f" ] && echo "$f" && cat "$f"; true`);
  if (result.code !== 0) fail(`read autoUpdate guard: ${result.err.trim()}`);
  const g = result.out.trim().split("\n");
  if (!g[0]) return "down: nothing to restore";
  const saved = JSON.parse(g[1]);
  await rpc("settings.set", { settings: { autoUpdate: saved.autoUpdate } });
  const restored = ssh(`mv ${g[0]} ${g[0].replace("guard.json", "guard.restored.json")}`);
  if (restored.code !== 0) fail(`mark autoUpdate restored: ${restored.err.trim()}`);
  return `down: autoUpdate ${saved.autoUpdate ? "on" : "off"} again`;
}

// --- parsing and main ----------------------------------------------------------

// Split a run into steps at `;` and newlines, and each step into words; quotes group.
function parse(src) {
  const steps = [];
  let words = [];
  let word = null;
  let quote = null;
  const end = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      word ??= "";
    } else if (ch === ";" || ch === "\n") {
      end();
      if (words.length) steps.push(words);
      words = [];
    } else if (ch === "#" && word === null && !words.length) {
      while (i < src.length && src[i] !== "\n") i++;
      i--;
    } else if (/\s/.test(ch)) end();
    else word = (word ?? "") + ch;
  }
  if (quote) fail("unterminated quote in run");
  end();
  if (words.length) steps.push(words);
  return steps;
}

const argv = process.argv.slice(2);
let steps;
if (argv[0] === "run") {
  const src = argv[1] === "-f" ? fs.readFileSync(argv[2], "utf8") : argv[1] === "-" ? fs.readFileSync(0, "utf8") : argv.slice(1).join(" ");
  steps = parse(src);
} else {
  steps = [argv.length ? argv : ["help"]];
}

const runner = new Runner();
let code = 0;
try {
  for (const words of steps) {
    const out = await runner.step(words);
    const label = words.join(" ");
    if (steps.length === 1) console.log(out || "ok");
    else console.log(`${label.length > 50 ? `${label.slice(0, 50)}…` : label}${out ? ` → ${out}` : ""}`);
  }
} catch (e) {
  code = 1;
  console.log(e instanceof StepError ? `FAIL ${e.message}` : `FAIL ${e.stack ?? e}`);
  if (steps.length > 1) await look().then((v) => console.log(`at: ${changes({}, v)}`)).catch(() => {});
} finally {
  await runner.pad.close();
}
process.exit(code);
