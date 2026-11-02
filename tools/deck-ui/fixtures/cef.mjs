// In-memory CEF for CLI regression tests. Never opens a socket or drives a device.
import vm from "node:vm";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

if (process.env.CEF_DEPLOY) {
  const original = childProcess.spawnSync;
  let uploaded = false;
  childProcess.spawnSync = (cmd, args, opts) => {
    if (cmd !== "ssh") return original(cmd, args, opts);
    const script = args.at(-1);
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
  syncBuiltinESMExports();
}
let focus = process.env.CEF_FOCUS || "Get Addons";
const element = (text) => ({
  textContent: text, innerText: text, ownerDocument: document,
  getBoundingClientRect: () => ({ x: 0, y: 0, right: 100, bottom: 30, width: 100, height: 30 }),
});
const document = {
  querySelector: () => element(focus),
  createTreeWalker: (el) => {
    let used = false;
    return {
      nextNode: () => used ? false : (used = true),
      currentNode: { parentElement: { tagName: "DIV" }, nodeValue: el.textContent },
    };
  },
};
const node = {
  m_element: element("Get Addons"), m_rgChildren: [],
  BTakeFocus: () => { if (process.env.CEF_REFUSE) return false; focus = "Get Addons"; return true; },
};
const tree = { m_ID: "QuickAccess-NA", Root: node, m_Root: node, m_lastFocusNode: node };
const context = vm.createContext({
  document, NodeFilter: { SHOW_TEXT: 4 }, location: { pathname: "/wowdeck" },
  window: {
    DFL: { Navigation: { CloseSideMenus: () => {} }, getFocusNavController: () => ({ GetActiveNavTree: () => tree }) },
    DeckyPluginLoader: { plugins: [{ name: "WoWDeck" }], deckyState: { _activePlugin: { name: "WoWDeck" } } },
  },
  DeckyBackend: { call: async (_loader, _plugin, _rpc, method, params) => {
    if (process.env.CEF_DEPLOY) {
      console.log(`fixture: rpc ${method} ${JSON.stringify(params)}`);
      if (method === "settings.get") return { settings: { autoUpdate: true } };
      if (method === "system.getStatus") return { pid: 123, backendVersion: "fixture" };
    }
    if (process.env.CEF_RPC_ERROR) return { __error: { code: "TEST", message: "rpc failed" } };
    return { method, params, rows: [{ name: "one" }, { name: "two" }] };
  } },
  // Resolve RPCs immediately; the timeout branch never fires in the fixture.
  setTimeout: () => {},
});
globalThis.fetch = async (url) => ({ ok: true, json: async () => String(url).endsWith("/json/version") ? { webSocketDebuggerUrl: "ws://fixture" } : [
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
    if (method === "Input.dispatchKeyEvent" && params.type === "keyUp" && params.key === "Enter") {
      console.log("fixture: Enter");
    }
    let result = {};
    try {
      if (method === "Runtime.evaluate") result = { result: { value: vm.runInContext(params.expression, context) } };
    } catch (e) { result = { exceptionDetails: { exception: { description: e.message } } }; }
    Promise.resolve(result.result?.value).then((value) => {
      if (result.result) result.result.value = value;
      const payload = process.env.CEF_PROTOCOL_ERROR ? { id, error: { message: "protocol failed" } } : { id, result };
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(payload) }));
    });
  }
};
