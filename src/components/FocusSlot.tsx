import { useEffect, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { FooterLegendProps } from "@decky/ui";
import { Focusable, PanelSectionRow } from "@decky/ui";
import { registerFocusElement, rememberFocus, rememberedFocus, restoreFocus } from "../focusMemory";

/**
 * Props that make a focusable row (a `Field focusable`, a DialogButton) part of
 * a view's focus memory (guide S21): Steam's own `preferredFocus` for the
 * remembered row, `onGamepadFocus` to remember it, and a ref so it can be
 * focused again after a remount.
 */
export function focusTarget(view: string, key: string) {
  return {
    preferredFocus: rememberedFocus(view) === key,
    onGamepadFocus: () => rememberFocus(view, key),
    ref: (el: HTMLDivElement | null) => registerFocusElement(view, key, el),
  };
}

/**
 * The same for a control that takes no such props (TextField, DropdownItem,
 * ButtonItem): a non-focusable group around it. Focus memory then goes to the
 * control inside the group.
 */
export function FocusSlot({
  view,
  id,
  actions,
  className,
  style,
  children,
}: {
  view: string;
  id: string;
  /** Extra footer actions (Y, X) for a control that takes none itself, like a dropdown. */
  actions?: FooterLegendProps;
  /** Extra classes on the row wrapper (e.g. the Options jump's highlight). */
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <Focusable
      {...actions}
      className={className}
      style={style}
      preferredFocus={rememberedFocus(view) === id}
      onGamepadFocus={() => rememberFocus(view, id)}
      ref={(el: HTMLDivElement | null) => registerFocusElement(view, id, el, true)}
    >
      {children}
    </Focusable>
  );
}

/**
 * On mount, focus the view's remembered row again (or as soon as it loads).
 * `enabled` false leaves focus where Steam put it (e.g. on the tab bar).
 */
export function useRestoreFocus(view: string, enabled = true): void {
  useEffect(() => {
    if (enabled) {
      restoreFocus(view);
    }
    // Once per mount: later changes of `enabled` must not pull focus.
  }, [view]);
}

/**
 * Put focus back on the view's remembered row when it falls to the page body
 * while the QAM is showing: the focused element was removed (Update all swaps
 * the toolbar for a progress bar) or moved (a reloaded list re-sorts the row
 * just updated), and Steam then leaves the controller on nothing (PC-16).
 * `anchorRef` is any element of the mounted view (for its document).
 */
export function useRefocusWhenLost(view: string, anchorRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const doc = anchorRef.current?.ownerDocument;
    const win = doc?.defaultView;
    if (!doc || !win) {
      return;
    }
    let frame = 0;
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) {
        return;
      }
      win.cancelAnimationFrame(frame);
      // After the render that removed it: the remembered row is registered again by then.
      frame = win.requestAnimationFrame(() => {
        const lost = !doc.activeElement || doc.activeElement === doc.body;
        // Hidden: a modal or menu took over, or the QAM closed; their own restore applies.
        if (lost && doc.visibilityState === "visible" && anchorRef.current?.isConnected) {
          restoreFocus(view);
        }
      });
    };
    doc.addEventListener("focusout", onFocusOut, true);
    return () => {
      win.cancelAnimationFrame(frame);
      doc.removeEventListener("focusout", onFocusOut, true);
    };
  }, [view]);
}

/** A QAM row (PanelSectionRow) whose control keeps its place in focus memory. */
export function FocusRow({
  view,
  id,
  actions,
  className,
  style,
  children,
}: {
  view: string;
  id: string;
  actions?: FooterLegendProps;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <PanelSectionRow>
      <FocusSlot view={view} id={id} actions={actions} className={className} style={style}>
        {children}
      </FocusSlot>
    </PanelSectionRow>
  );
}
