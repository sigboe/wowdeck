// Guideline audit for the view currently on screen in one Steam CEF target.
// Run: node audit-view.mjs <target>  (sets the Field class, then runs this; read-only)
//
// Checks the measurable rules of docs/UI_DEVELOPMENT_BEST_PRACTICES.md:
// - INSET (S10, S8): content inside an element that is highlighted on focus
//   must keep space from the highlight's edges. Reports focus targets whose
//   visible content comes closer than MIN_INSET px to their own box.
// - TOUCH (S10): two focus targets whose boxes touch or overlap.
// - SMALL_TEXT (S11): visible text under 12 px.
// - TEXTFIELD (S28): a text input not inside a Field row.
// - CLIPPED: text cut off by its own box (scrollWidth > clientWidth without an
//   ellipsis on purpose).
// - OVERFLOW (S32): anything in the QAM panel that reaches past the panel's
//   own left or right edge (the Update all progress bar ran 136 px out).
// Scope: our own UI only (inside .wowdeck-root, our modals, our page).
(() => {
  const MIN_INSET = 6;
  const out = { view: location.href.slice(-40), issues: [] };
  const roots = [
    ...document.querySelectorAll(
      ".wowdeck-root, .wowdeck-scroll-buffer, .wowdeck-page-bar, .wowdeck-details-stage",
    ),
  ].filter((r, i, a) => !a.some((o, j) => j !== i && o.contains(r) && o !== r));
  if (!roots.length) return JSON.stringify({ error: "none of our UI on this target" });
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0;
  };
  const label = (e) =>
    ((e.innerText || e.getAttribute("aria-label") || "").trim().split("\n")[0] || e.tagName).slice(0, 40);
  const R = (e) => e.getBoundingClientRect();
  const focusables = roots.flatMap((r) => [...r.querySelectorAll(".Focusable[tabindex]")]).filter(vis);
  // Elements that light up while focus is inside them: Steam's Field rows
  // (class from @decky/ui gamepadDialogClasses.Field, passed in as FIELD_CLASS
  // because this document cannot see @decky/ui) and buttons.
  const FIELD_CLASS = globalThis.__AUDIT_FIELD_CLASS__ || "";
  const highlightables = [
    ...new Set([
      ...focusables,
      ...roots.flatMap((r) => (FIELD_CLASS ? [...r.querySelectorAll("." + FIELD_CLASS)] : [])),
    ]),
  ].filter((e) => vis(e) && e.querySelector(".Focusable[tabindex]") !== null || e.matches(".Focusable[tabindex]"));

  // Visible content boxes inside an element: text runs, images, svgs, form controls.
  const contentBoxes = (el) => {
    const boxes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        if (!n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const b of range.getClientRects()) if (b.width && b.height) boxes.push(b);
      } else if (/^(IMG|SVG|svg|INPUT|TEXTAREA|CANVAS)$/.test(n.tagName) && vis(n)) {
        boxes.push(R(n));
      } else if (n !== el && n.matches(".Focusable[tabindex]") && vis(n)) {
        // A focus target inside another one (a button in a row): its box is content.
        boxes.push(R(n));
      }
    }
    return boxes;
  };

  for (const el of highlightables) {
    const b = R(el);
    const boxes = contentBoxes(el);
    if (!boxes.length) continue;
    const left = Math.min(...boxes.map((x) => x.left)) - b.left;
    const right = b.right - Math.max(...boxes.map((x) => x.right));
    const top = Math.min(...boxes.map((x) => x.top)) - b.top;
    const bottom = b.bottom - Math.max(...boxes.map((x) => x.bottom));
    const tight = [["left", left], ["right", right], ["top", top], ["bottom", bottom]].filter(
      ([, v]) => v < MIN_INSET - 0.5,
    );
    if (tight.length) {
      out.issues.push({
        rule: "INSET",
        el: label(el),
        cls: String(el.className).slice(0, 60),
        box: [b.left, b.top, b.width, b.height].map(Math.round),
        insets: Object.fromEntries(tight.map(([k, v]) => [k, Math.round(v)])),
      });
    }
  }

  for (let i = 0; i < focusables.length; i++) {
    for (let j = i + 1; j < focusables.length; j++) {
      const a = focusables[i];
      const c = focusables[j];
      if (a.contains(c) || c.contains(a)) continue;
      const p = R(a);
      const q = R(c);
      const gapX = Math.max(q.left - p.right, p.left - q.right);
      const gapY = Math.max(q.top - p.bottom, p.top - q.bottom);
      const gap = Math.max(gapX, gapY);
      // Steam's classic list rows meet at a 1 px separator by design (S16):
      // a vertical touch between two Field rows is Valve's own pattern.
      const fieldRows = FIELD_CLASS && a.closest("." + FIELD_CLASS) && c.closest("." + FIELD_CLASS);
      if (gap < 1 && !(gapY >= gapX && fieldRows)) {
        out.issues.push({
          rule: "TOUCH",
          a: label(a),
          b: label(c),
          gap: Math.round(gap * 10) / 10,
          boxes: [[p.left, p.top, p.width, p.height].map(Math.round), [q.left, q.top, q.width, q.height].map(Math.round)],
        });
      }
    }
  }

  for (const r of roots) {
    const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      if (!n.textContent.trim() || !p || seen.has(p) || !vis(p)) continue;
      seen.add(p);
      const cs = getComputedStyle(p);
      const size = parseFloat(cs.fontSize);
      // Steam's own glyph component draws its keycaps; not ours to size.
      if (size < 12 && !p.closest(".wowdeck-glyph")) out.issues.push({ rule: "SMALL_TEXT", el: label(p), size });
      if (p.scrollWidth > p.clientWidth + 1 && cs.textOverflow !== "ellipsis" && cs.overflow !== "visible") {
        out.issues.push({ rule: "CLIPPED", el: label(p), over: p.scrollWidth - p.clientWidth });
      }
    }
  }
  // TEXTFIELD (S28): a text input belongs in a Field row (Steam's settings
  // pattern), not in TextField's own label group (login-dialog pattern).
  for (const r of roots) {
    for (const inp of r.querySelectorAll("input")) {
      if (inp.type === "range" || inp.type === "checkbox" || !vis(inp)) continue;
      const row = FIELD_CLASS ? inp.closest("." + FIELD_CLASS) : null;
      if (!row || inp.closest(".DialogInputLabelGroup")) {
        out.issues.push({ rule: "TEXTFIELD", el: label(inp.closest(".DialogInputLabelGroup") || inp.parentElement) });
      }
    }
  }
  // OVERFLOW (S32): only the QAM panel; the Details stage is a carousel whose
  // neighbouring pages sit off screen on purpose.
  for (const panel of document.querySelectorAll(".wowdeck-root")) {
    const p = R(panel);
    const seen = new Set();
    for (const e of panel.querySelectorAll("*")) {
      if (!vis(e)) continue;
      const b = R(e);
      const over = Math.max(b.right - p.right, p.left - b.left);
      // Report the outermost element that overflows, not each of its children.
      if (over > 0.5 && ![...seen].some((s) => s.contains(e))) {
        seen.add(e);
        out.issues.push({ rule: "OVERFLOW", el: label(e), cls: String(e.className).slice(0, 60), px: Math.round(over) });
      }
    }
  }
  out.focusables = focusables.length;
  return JSON.stringify(out, null, 1);
})();
