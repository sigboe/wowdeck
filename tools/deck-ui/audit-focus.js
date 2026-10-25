// Highlight audit for whatever has focus right now (rule S10 / S8: nothing
// touches the edge of a focus highlight). Use with step.mjs to walk a view:
//   node step.mjs <target> ArrowDown <n> 400 audit-focus.js
// Finds the element that actually draws the highlight (the focused element or
// the nearest ancestor that gets a background, shadow or outline while focus
// is in it) and measures how close its content comes to the highlight's edges.
(() => {
  const MIN_INSET = 6;
  const f = document.querySelector(".gpfocus");
  if (!f) return "no focus";
  const ours = f.closest(".wowdeck-root, .wowdeck-scroll-buffer, .wowdeck-page-bar, .wowdeck-details-stage");
  if (!ours) return `outside our UI ("${(f.innerText || f.getAttribute("aria-label") || f.tagName).trim().slice(0, 30)}")`;
  const label = (e) => ((e.innerText || e.getAttribute("aria-label") || "").trim().split("\n")[0] || e.tagName).slice(0, 30);
  const painted = (e) => {
    const cs = getComputedStyle(e);
    const bg = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
    const img = cs.backgroundImage !== "none";
    const shadow = cs.boxShadow !== "none";
    const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
    const before = getComputedStyle(e, "::before");
    const pseudo = before.content !== "none" && before.backgroundColor !== "rgba(0, 0, 0, 0)";
    return bg || img || shadow || outline || pseudo;
  };
  // Every element that lights up while focus is here: the focused element and
  // each ancestor with a highlight (Steam's Field rows light up on focus-within).
  // Static paint (the panel's own background, our floating pane) is not a highlight.
  const STATIC_BG = ["rgb(14, 20, 27)"];
  const highlights = [];
  for (let e = f; e && e !== document.body; e = e.parentElement) {
    if (ours && (e === ours || e.classList.contains("wowdeck-float-pane"))) break;
    if (painted(e) && !STATIC_BG.includes(getComputedStyle(e).backgroundColor)) highlights.push(e);
    if (e === ours) break;
  }
  if (!highlights.length) return `focus "${label(f)}": no highlight found`;
  const results = highlights.map((h) => check(h));
  const bad = results.filter((r) => r.startsWith("ISSUE"));
  return bad.length ? bad.join(" | ") : results[results.length - 1];

  function check(h) {
    const b = h.getBoundingClientRect();
    const boxes = [];
    const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        if (!n.textContent.trim()) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        for (const x of r.getClientRects()) if (x.width && x.height) boxes.push({ x, what: n.textContent.trim().slice(0, 16) });
      } else if (n !== h && n.getBoundingClientRect().width > 0) {
        const tag = n.tagName.toLowerCase();
        const isControl = /^(img|svg|input|textarea|button)$/.test(tag) || n.matches(".Focusable[tabindex]");
        const cs = getComputedStyle(n);
        const hasPaint = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.borderStyle !== "none";
        if (isControl || hasPaint) boxes.push({ x: n.getBoundingClientRect(), what: label(n) || tag });
      }
    }
    const hl = `${label(h)} [${String(h.className).slice(0, 40)}] ${Math.round(b.width)}x${Math.round(b.height)}`;
    if (!boxes.length) return `ok    focus "${label(f)}" highlight ${hl} (empty)`;
    const edge = (side) => {
      let best = null;
      for (const { x, what } of boxes) {
        const d = side === "left" ? x.left - b.left : side === "right" ? b.right - x.right : side === "top" ? x.top - b.top : b.bottom - x.bottom;
        if (!best || d < best.d) best = { d, what };
      }
      return best;
    };
    const tight = ["left", "right", "top", "bottom"].map((s) => [s, edge(s)]).filter(([, v]) => v.d < MIN_INSET - 0.5);
    return tight.length
      ? `ISSUE focus "${label(f)}" highlight ${hl}: ` + tight.map(([s, v]) => `${s} ${Math.round(v.d)}px (${v.what})`).join(", ")
      : `ok    focus "${label(f)}" highlight ${hl}`;
  }
})();
