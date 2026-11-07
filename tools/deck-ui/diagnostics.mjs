// Use the same label for focus capture and seek, including controls with help text.
export function elementLabel(element) {
  if (!element) return "";
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text = "";
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (parent && (parent.tagName === "STYLE" || parent.tagName === "SCRIPT")) continue;
    text += walker.currentNode.nodeValue + " ";
  }
  return text.trim().replace(/\s+/g, " ").slice(0, 200);
}

// Read-only browser probes. Deliberately return names/counts, never props or hook values.
export function reactProbe(selector, limit) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no element at ${selector}`);
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  let fiber = key ? el[key] : null;
  const components = [];
  const seen = new Set();
  while (fiber && components.length < limit && !seen.has(fiber)) {
    seen.add(fiber);
    const type = fiber.elementType || fiber.type;
    const name = typeof type === 'string' ? type : type?.displayName || type?.name || type?.render?.name || 'anonymous';
    components.push({ name: String(name).slice(0, 100), patched: !!type?.__deckyPatch });
    fiber = fiber.return;
  }
  return { components, truncated: !!fiber, supported: !!key };
}

export function uiDiagnostics() {
  const selected = document.querySelector('.wowdeck-tab-selected');
  // Scope text to WoWDeck; never collect Steam's inputs or React state.
  const root = selected?.closest('.wowdeck-root') || document.querySelector('.wowdeck-root');
  return {
    tab: selected?.textContent?.trim() || null,
    busy: root ? root.querySelectorAll('[aria-busy="true"], [role="progressbar"]').length : null,
    alerts: root ? [...root.querySelectorAll('[role="alert"]')].slice(0, 5).map(e => (e.textContent || '').slice(0, 160)) : [],
  };
}

export function checkMethods(frontend, bridge, contracts) {
  const python = new Set([...bridge.matchAll(/^    async def ([a-z]\w*)\(/gm)].map(m => m[1]));
  const names = [...frontend.matchAll(/(?:call(?:<[\s\S]*?>)?|callable(?:<[\s\S]*?>)?)\(\s*["']([\w.]+)["']/g)].map(m => m[1]);
  const engine = [...frontend.matchAll(/\brpc\(\s*["']([\w.]+)["']/g)].map(m => m[1]);
  return {
    bridge: [...new Set(names)].sort(),
    missingBridge: [...new Set(names.filter(n => !python.has(n)))].sort(),
    unknownRpc: [...new Set(engine.filter(n => !contracts.includes(n)))].sort(),
  };
}

// Shared output boundary for snapshots, React names and logs.
export function redact(value) {
  return String(value)
    .replace(/\bBearer\s+\S+/gi, 'Bearer <REDACTED>')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '<URL>')
    .replace(/((?:token|cookie|authorization|api[_-]?key|secret|password)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1<REDACTED>');
}

export function scrub(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
  return value;
}
