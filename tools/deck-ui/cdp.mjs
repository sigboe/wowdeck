// Shared CDP helpers for the deck-ui scripts (Node 22, no dependencies).
const port = () => process.env.DECK_UI_PORT || "18080";
const TIMEOUT = 10000;

export async function targets() {
  const res = await fetch(`http://localhost:${port()}/json`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`CEF targets: HTTP ${res.status}`);
  return res.json();
}

export async function connect(want) {
  const list = await targets();
  const t = list.find((x) => x.title.includes(want) && x.webSocketDebuggerUrl);
  if (!t) throw new Error(`no target "${want}"; have: ${list.map((x) => x.title).join(", ")}`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  const rejectAll = () => {
    for (const p of pending.values()) p.reject(new Error("CEF connection closed"));
  };
  ws.addEventListener("close", rejectAll);
  ws.addEventListener("error", rejectAll);
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    const p = pending.get(d.id);
    if (p) {
      if (d.error) p.reject(new Error(`CDP: ${d.error.message}`));
      else p.resolve(d);
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("CEF connection timed out")), TIMEOUT);
    const opened = () => done();
    const failed = () => done(new Error("CEF connection failed"));
    function done(error) {
      clearTimeout(timer);
      ws.removeEventListener("open", opened);
      ws.removeEventListener("error", failed);
      ws.removeEventListener("close", failed);
      if (error) { ws.close(); reject(error); }
      else resolve();
    }
    ws.addEventListener("open", opened);
    ws.addEventListener("error", failed);
    ws.addEventListener("close", failed);
  });
  const send = (method, params = {}, timeout = TIMEOUT) => new Promise((resolve, reject) => {
    const my = ++id;
    const timer = setTimeout(() => finish(reject, new Error(`CDP ${method} timed out after ${timeout} ms${method === "Runtime.evaluate" ? "; page-side work may still be running; inspect before retrying" : ""}`)), timeout);
    function finish(fn, value) {
      clearTimeout(timer);
      pending.delete(my);
      fn(value);
    }
    pending.set(my, {
      resolve: (v) => finish(resolve, v),
      reject: (e) => finish(reject, e),
    });
    try { ws.send(JSON.stringify({ id: my, method, params })); }
    catch (e) { finish(reject, e); }
  });
  return { ws, send, close: () => ws.close() };
}

// Evaluate one expression in one target; throws on a page exception.
export async function evalIn(want, expr, timeout = TIMEOUT) {
  const { send, close } = await connect(want);
  try {
    const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, timeout);
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description ?? "evaluation failed");
    }
    return res.result?.result?.value;
  } finally {
    close();
  }
}

// Print a value the way the scripts do: strings raw, everything else compact.
export function print(v, pretty = false) {
  if (typeof v === "string") console.log(v);
  else console.log(pretty ? JSON.stringify(v, null, 1) : JSON.stringify(v));
}
