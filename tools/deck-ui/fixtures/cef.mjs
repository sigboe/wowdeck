// In-memory CEF for CLI regression tests. Never opens a socket or drives a device.
import vm from "node:vm";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

const realSetTimeout = globalThis.setTimeout;
let lastTimer;
let tunnelOpened = !process.env.CEF_TUNNEL;
globalThis.setTimeout = (callback, delay, ...args) => {
  const timer = realSetTimeout(callback, delay, ...args);
  lastTimer = { callback, delay, timer };
  if (delay === { "start-stall": 15000, "press-stall": 120000, "close-stall": 5000 }[process.env.CEF_PAD]) {
    clearTimeout(timer);
    queueMicrotask(callback);
  }
  return timer;
};

if (process.env.CEF_DEPLOY || process.env.CEF_PAD || process.env.CEF_LOG_HOME) {
  const original = childProcess.spawnSync;
  let uploaded = false;
  childProcess.spawnSync = (cmd, args, opts) => {
    if (cmd !== "ssh") return original(cmd, args, opts);
    if (opts.timeout !== (args.includes("-N") ? 15000 : 30000) || opts.killSignal !== "SIGKILL" || !args.includes("ControlPath=none")) {
      throw new Error("unbounded or shared SSH connection");
    }
    if (args.includes("-N")) {
      tunnelOpened = true;
      console.log(`fixture: tunnel ${args.at(-1)}`);
      return { status: 0, stdout: "", stderr: "" };
    }
    const script = args.at(-1);
    if (args.at(-2) === "unreachable") return { status: null, error: new Error("spawnSync ssh ETIMEDOUT"), stdout: "", stderr: "" };
    if (process.env.CEF_LOG_HOME) return original("sh", ["-c", script], { ...opts, env: { ...process.env, HOME: process.env.CEF_LOG_HOME } });
    console.log(`fixture: ssh ${script}`);
    if (process.env.CEF_DEPLOY === "guard-fail" && script.includes("> ") && script.includes("/guard.json")) {
      return { status: 1, stdout: "", stderr: "guard write failed" };
    }
    if (script.startsWith("cat > ")) uploaded = true;
    let stdout = "";
    if (uploaded && script.startsWith("sha256sum ")) {
      const root = path.resolve(path.dirname(process.argv[1]), "../..");
      stdout = [["dist/index.js", "dist/index.js"], ["main.py", "main.py"]].map(([local, remote]) =>
        `${createHash("sha256").update(readFileSync(path.join(root, local))).digest("hex")}  /home/deck/homebrew/plugins/wowdeck/${remote}`,
      ).join("\n");
    }
    return { status: 0, stdout, stderr: "" };
  };
  if (process.env.CEF_PAD) childProcess.spawn = (command, args) => {
    if (command !== "ssh" || !args.includes("ControlPath=none") || args.at(-2) !== "fixture") {
      throw new Error("unexpected controller connection");
    }
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = new Writable({ write(_chunk, _encoding, done) {
      if (process.env.CEF_PAD !== "press-stall") proc.stdout.write("ok\n");
      done();
    } });
    proc.kill = (signal) => {
      console.log(`fixture: killed controller SSH ${signal}`);
      proc.stdout.end();
      proc.stderr.end();
      proc.emit("close", null, signal);
    };
    if (process.env.CEF_PAD !== "start-stall") queueMicrotask(() => proc.stdout.write("ready\n"));
    return proc;
  };
  syncBuiltinESMExports();
}
let focus = process.env.CEF_FOCUS || "Get Addons";
let tab = "Get Addons";
const element = (text) => ({
  textContent: text, innerText: text, ownerDocument: document,
  getBoundingClientRect: () => ({ x: 0, y: 0, right: 100, bottom: 30, width: 100, height: 30 }),
});
const document = {
  querySelector: (selector) => element(selector === ".wowdeck-tab-selected" ? tab : focus),
  createTreeWalker: (el) => {
    let used = false;
    return {
      nextNode: () => used ? false : (used = true),
      currentNode: { parentElement: { tagName: "DIV" }, nodeValue: el.textContent },
    };
  },
};
const node = {
  m_element: element(process.env.CEF_FOCUS || "Get Addons"), m_rgChildren: [],
  BTakeFocus: () => { if (process.env.CEF_REFUSE) return false; focus = node.m_element.textContent; tree.m_lastFocusNode = node; return true; },
};
if (process.env.CEF_FOCUS) {
  const tabNode = { m_element: element("Get Addons"), m_rgChildren: [],
    BTakeFocus: () => { focus = "Get Addons"; tree.m_lastFocusNode = tabNode; return true; } };
  node.m_rgChildren.push(tabNode);
}
const tree = { m_ID: "QuickAccess-NA", Root: node, m_Root: node, m_lastFocusNode: node };
const context = vm.createContext({
  document, NodeFilter: { SHOW_TEXT: 4 }, location: { pathname: "/wowdeck" },
  window: {
    DFL: { Navigation: { CloseSideMenus: () => {}, OpenQuickAccessMenu: () => {} }, getFocusNavController: () => ({ GetActiveNavTree: () => tree }) },
    DeckyPluginLoader: { plugins: [{ name: "WoWDeck" }], unloadPlugin: () => { if (process.env.CEF_RELOAD_TRACE) console.log("fixture frontend unloaded"); }, deckyState: { setPlugins: () => {}, setActivePlugin: () => {}, _activePlugin: { name: "WoWDeck" } } },
  },
  DeckyBackend: { call: async (_loader, _plugin, _rpc, method, params) => {
    if (process.env.CEF_RELOAD_TRACE) throw new Error("frontend reload must not call the backend");
    if (_loader === "loader/reload_plugin" && process.env.CEF_DEPLOY === "reload-fail") {
      throw new Error("reload rejected");
    }
    if (process.env.CEF_DEPLOY) {
      console.log(`fixture: rpc ${method} ${JSON.stringify(params)}`);
      if (method === "settings.get") return { settings: { autoUpdate: true } };
      if (method === "system.getStatus") return { pid: 123, backendVersion: "fixture" };
    }
    if (process.env.CEF_DIAG && method === "system.getStatus") return { pid: 42, backendVersion: "fixture", protocolVersion: 1, homeDir: "PRIVATE" };
    if (process.env.CEF_DIAG && method === "installations.list") return { installations: [{ id: "retail", gameType: "retail", selected: true, path: "PRIVATE" }] };
    if (process.env.CEF_RPC_ERROR) return { __error: { code: "TEST", message: "rpc failed" } };
    return { method, params, rows: [{ name: "one" }, { name: "two" }] };
  } },
  // Resolve RPCs immediately; the timeout branch never fires in the fixture.
  setTimeout: (callback, ms) => { if (ms < 1000) queueMicrotask(callback); },
});
globalThis.fetch = async (url) => ({ ok: true, json: async () => String(url).endsWith("/json/version") ? (tunnelOpened ? { webSocketDebuggerUrl: "ws://fixture" } : {}) : [
  { title: "SharedJSContext", webSocketDebuggerUrl: "ws://fixture/shared" },
  { title: "QuickAccess_uid2", webSocketDebuggerUrl: "ws://fixture/qam" },
] });
globalThis.WebSocket = class extends EventTarget {
  constructor() {
    super();
    queueMicrotask(() => this.dispatchEvent(new Event(process.env.CEF_CONNECT_ERROR ? "error" : "open")));
  }
  close() { this.dispatchEvent(new Event("close")); }
  send(src) {
    const { id, method, params } = JSON.parse(src);
    if (method === "Input.dispatchKeyEvent" && params.type === "keyUp" && params.key === "ArrowRight") tab = "Options";
    if (method === "Input.dispatchKeyEvent" && params.type === "keyUp" && params.key === "Enter") {
      console.log("fixture: Enter");
    }
    let result = {};
    try {
      if (method === "Runtime.evaluate") {
        if (params.expression.includes("/* fixture timeout */") ||
            (params.expression.includes("/* fixture long */") && lastTimer.delay < 120000)) {
          clearTimeout(lastTimer.timer);
          queueMicrotask(lastTimer.callback);
          return;
        }
        result = { result: { value: vm.runInContext(params.expression, context, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }) } };
      }
    } catch (e) { result = { exceptionDetails: { exception: { description: e.message } } }; }
    const respond = () => {
      const payload = process.env.CEF_PROTOCOL_ERROR ? { id, error: { message: "protocol failed" } } : { id, result };
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
    };
    Promise.resolve(result.result?.value).then((value) => {
      if (result.result) result.result.value = value;
      respond();
    }, (error) => {
      result = { exceptionDetails: { exception: { description: error.message } } };
      respond();
    });
  }
};
