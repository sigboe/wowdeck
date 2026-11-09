// Active-document evaluation for deck.mjs. At execution time, resolve the
// root owner document of Steam's active navigation tree — the same document
// focus navigation (seek.mjs) walks, including while the QAM or a modal has
// focus — and expose it to the expression as `doc`. Global browser objects
// stay bound to their own context; the expression reaches the active document
// only through `doc`. Each evaluation resolves the tree again, so navigation
// between calls is picked up. No active tree or root document is an explicit
// error; the expression never runs against a fallback document.

export const ACTIVE_TARGET = "SharedJSContext";

export function activeDocExpr(src) {
  return `(() => {
  const c = window.DFL && window.DFL.getFocusNavController && window.DFL.getFocusNavController();
  const t = c && c.GetActiveNavTree && c.GetActiveNavTree();
  const root = t && (t.Root || t.m_Root);
  const doc = root && root.m_element && root.m_element.ownerDocument;
  if (!doc) throw new Error("no active document: the active navigation tree has no root owner document (open the QAM or the focused menu first)");
  return eval(${JSON.stringify(src)});
})()`;
}
