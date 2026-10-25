/**
 * Steam's modal chrome around the addon Details carousel.
 *
 * Depends on: Steam's modal DOM: an absolutely positioned scroll wrapper
 * (`position: absolute; overflow-y: auto`) above the dialog box, and the
 * plain class names `ModalOverlayContent` / `ModalOverlayBackground` for the
 * dimming layer (DEVICE 2026-10-15).
 * Fails as: a Steam change leaves Steam's own chrome in place: the carousel
 * shows inside a 660 px dialog, or over 85 % black. Nothing throws, nothing
 * else is touched (the modal is destroyed on close; dimming is put back).
 * Kill switch: none needed; drop the two calls in AddonDetailsModal.
 */

/**
 * Steam draws a 660 px dialog box (solid background, padding, an identity
 * `transform` that would also trap `position: fixed`) around modal content.
 * The carousel needs the whole screen, so strip that chrome from every
 * ancestor up to Steam's absolutely positioned scroll wrapper. Class names
 * are obfuscated, so this goes by computed style only. The modal is
 * destroyed on close, so nothing needs restoring.
 */
export function stripModalChrome(start: HTMLElement | null): void {
  for (let el = start?.parentElement ?? null; el; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.position === "absolute" && cs.overflowY === "auto") {
      el.style.overflow = "visible";
      return;
    }
    el.style.background = "transparent";
    el.style.boxShadow = "none";
    el.style.border = "none";
    el.style.padding = "0";
    // Steam animates `transform` on the dialog (computed stays an identity
    // matrix despite an inline `none`), so stop the animation too.
    el.style.animation = "none";
    el.style.setProperty("transform", "none", "important");
    el.style.width = "auto";
    el.style.height = "auto";
    el.style.minHeight = "0";
  }
}

/**
 * Steam dims everything behind a modal with its own layer: the sibling
 * `.ModalOverlayBackground` of the modal's `.ModalOverlayContent`, at
 * `rgba(0,0,0,.85)` + `blur(3px)` (DEVICE, read-only CDP, 2026-10-15). Steam's
 * news view is not a modal and has no such layer: only the blur/brightness/
 * saturate backdrop over the live screen. Under ours the 85 % black made the
 * background look black, so clear that one layer while Details is open and put
 * Steam's values back on close (other modals keep their dimming). Plain
 * (non-hashed) class names, found from our own element outward.
 * Returns the restore function.
 */
export function clearModalDimming(start: HTMLElement | null): () => void {
  const content = start?.closest<HTMLElement>(".ModalOverlayContent");
  const layers = Array.from(content?.parentElement?.children ?? []).filter((e) =>
    e.classList.contains("ModalOverlayBackground"),
  ) as HTMLElement[];
  const saved = layers.map((e) => ({
    e,
    background: e.style.background,
    backdropFilter: e.style.backdropFilter,
  }));
  layers.forEach((e) => {
    e.style.background = "transparent";
    e.style.backdropFilter = "none";
  });
  return () =>
    saved.forEach(({ e, background, backdropFilter }) => {
      e.style.background = background;
      e.style.backdropFilter = backdropFilter;
    });
}
