// Toast capture for deck.mjs runs: an observer in the notification-toasts
// document retains each notice's complete displayed text in order, so a toast
// that appears between probes or beside controller notifications is still
// evidence when the run reads it. The page side only reads notice text: it does
// not touch the notification queue, plugin calls, Steam settings, cookies,
// tokens or account data. State lives at window.__wowdeckToasts, so it survives
// the per-call CDP connections and is removed by toast-stop.

// Steam controller notices sit under the alert container with hashed classes.
// Keep the class selector for plugin notices outside that container.
export const TOAST_TARGET = "notificationtoasts";
export const TOAST_SELECTOR = "[role='alert'] > *, [class*='toast' i]";
export const TOAST_LIMIT = 50;

export function toastStartExpr(selector, limit) {
  return `(() => {
  if (window.__wowdeckToasts) return JSON.stringify({ installed: false });
  const state = { history: [], live: new Map(), missed: 0, limit: ${limit}, observers: null };
  const selector = ${JSON.stringify(selector)};
  const candidates = (root, alertChild = false) => {
    const els = [...(alertChild || root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    return els.filter((el) => !el.parentElement?.closest(selector) && !els.some((parent) => parent !== el && parent.contains(el)));
  };
  const retain = (el, removed = false) => {
    const at = state.live.get(el);
    // A detached node cannot prove what was rendered. Preserve known text;
    // count unseen occurrences as missed instead of reconstructing raw DOM text.
    if (removed) {
      if (at === undefined) {
        state.missed++;
        state.live.set(el, -1);
      }
      return;
    }
    const shown = (el.innerText || "").trim().replace(/\\s+/g, " ");
    if (at !== undefined) {
      if (shown && state.history[at]) state.history[at].text = shown;
      return;
    }
    if (!shown) return;
    if (state.history.length >= state.limit) {
      state.missed++;
      state.live.set(el, -1);
      return;
    }
    state.live.set(el, state.history.length);
    state.history.push({ text: shown });
  };
  const scan = () => {
    const els = candidates(document);
    for (const el of [...state.live.keys()]) if (!els.includes(el)) state.live.delete(el);
    for (const el of els) retain(el);
  };
  state.observers = new MutationObserver((records) => {
    const known = new Map([...state.live].map(([el, at]) => [el, state.history[at]?.text]));
    // Reusing one node twice before delivery loses its earlier rendered
    // contents. Do not invent occurrence text from its final DOM state.
    const additions = new Map();
    for (const record of records) {
      for (const node of record.addedNodes || []) additions.set(node, (additions.get(node) || 0) + 1);
    }
    // Replay additions in mutation order, including subtrees already removed
    // by delivery time. The alert parent identifies detached controller nodes.
    for (const record of records) {
      for (const node of record.addedNodes || []) {
        if (!node.querySelectorAll) continue;
        const alertChild = selector === ${JSON.stringify(TOAST_SELECTOR)} && record.target.matches?.("[role='alert']");
        for (const el of candidates(node, alertChild)) {
          const unchanged = known.get(el) === undefined ||
            (el.innerText || "").trim().replace(/\\s+/g, " ") === known.get(el);
          if (known.has(el) && el.isConnected && unchanged) retain(el);
          else if (known.has(el) || additions.get(node) > 1) {
            state.missed++;
            state.live.set(el, -1);
          } else retain(el, !el.isConnected);
        }
      }
      for (const node of record.removedNodes || []) {
        for (const el of [...state.live.keys()]) {
          if (node === el || node.contains?.(el)) {
            retain(el, true);
            if (!el.isConnected) state.live.delete(el);
          }
        }
      }
    }
    scan();
  });
  state.observers.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  scan();
  window.__wowdeckToasts = state;
  return JSON.stringify({ installed: true, limit: state.limit, active: state.live.size });
})()`;
}

export function toastReadExpr() {
  return `(() => {
  const s = window.__wowdeckToasts;
  if (!s) return JSON.stringify({ on: false });
  return JSON.stringify({ on: true, count: s.history.length, limit: s.limit, missed: s.missed,
    incomplete: s.missed > 0, active: s.live.size, entries: s.history.map((e) => e.text) });
})()`;
}

export function toastResetExpr() {
  return `(() => {
  const s = window.__wowdeckToasts;
  if (!s) return JSON.stringify({ on: false });
  const cleared = s.history.length;
  s.history.length = 0;
  for (const el of s.live.keys()) s.live.set(el, -1);
  s.missed = 0;
  return JSON.stringify({ on: true, cleared, active: s.live.size });
})()`;
}

export function toastStopExpr() {
  return `(() => {
  const s = window.__wowdeckToasts;
  if (!s) return JSON.stringify({ on: false });
  s.observers.disconnect();
  const report = { stopped: true, retained: s.history.length, count: s.history.length,
    missed: s.missed, incomplete: s.missed > 0, entries: s.history.map((e) => e.text) };
  delete window.__wowdeckToasts;
  return JSON.stringify(report);
})()`;
}
