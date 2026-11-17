import { Field, PanelSectionRow, Spinner } from "@decky/ui";
import { useEffect, useRef } from "react";
import { forgetFocus, rememberedFocus, revealRemembered } from "../focusMemory";
import { layoutRow, useControllerLayoutCatalogue } from "../controllerLayouts";
import { useControllerLayoutsSourceOn } from "../controllerLayoutsSource";
import { focusTarget } from "./FocusSlot";
import { FactLine } from "./FactLine";
import { STEAM, STEAM_FONT, STEAM_LINE, STEAM_LINE_GAP, descriptionStyle } from "../steamTheme";
import type { ControllerLayout } from "../../backend/src/api/contracts";

/**
 * The Controller layouts destination's pane (GLOSSARY: Controller layouts
 * destination): the reviewed catalogue in the maintainers' order, with no
 * search, sorting or browse bar. Browse only until applying a layout exists
 * (#261), so a row has no action: A does nothing and the footer names none.
 * Each layout is one focus stop (S14) that keeps its place (S21), read the
 * way Steam's controller-layout browser reads one: the title at 16/20 px,
 * then author and controller, then the description. The rows are Steam's
 * own QAM `Field`s (G3, S3), whose padding and 2 px radius stand in for the
 * native browser's 8 px card padding at the pane's width.
 *
 * Nothing is shown or read while the source is off (see
 * `controllerLayoutsEnabled` in the contract).
 */
export function ControllerLayoutsTab({ view }: { view: string }) {
  const sourceOn = useControllerLayoutsSourceOn();
  const catalogue = useControllerLayoutCatalogue(sourceOn);
  if (!sourceOn) {
    return null;
  }
  return <CatalogueBody catalogue={catalogue} view={view} />;
}

function CatalogueBody({
  catalogue: { shown, loading, refresh },
  view,
}: {
  catalogue: ReturnType<typeof useControllerLayoutCatalogue>;
  /** Focus-memory view (browseFocusView). */
  view: string;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // Retry swaps its own row for what comes back (layouts, a note, or the
  // Retry row again): focus moves to the pane's first stop once it has
  // settled, instead of falling to nothing with the removed row (S21).
  const retried = useRef(false);
  useEffect(() => {
    if (!retried.current || loading) {
      return;
    }
    retried.current = false;
    const first = bodyRef.current?.querySelector<HTMLElement>(
      ".wowdeck-layout-row, .wowdeck-layout-state, .wowdeck-layout-retry",
    );
    // After Steam has registered the new rows (guide G7).
    const timer = setTimeout(() => first?.focus(), 0);
    return () => clearTimeout(timer);
  }, [loading, shown.kind]);
  // A remembered row this state doesn't show (a layout before a failed
  // reload, Retry once the layouts are in) is forgotten, so entering the
  // pane lands on its first stop instead of waiting for a row that won't come.
  useEffect(() => {
    const keys = shown.kind === "ready" ? shown.layouts.map((l) => l.id) : ["retry", "state"];
    const key = rememberedFocus(view);
    if (key !== undefined && !keys.includes(key)) {
      forgetFocus(view);
    }
  }, [view, shown]);
  // The pane's scroll container survives destination swaps: show the
  // remembered layout (without focusing it) once the rows are in, as the
  // addon lists do.
  useEffect(() => {
    if (shown.kind === "ready") {
      revealRemembered(view);
    }
  }, [view, shown.kind]);
  return <div ref={bodyRef}>{body()}</div>;

  function body() {
    switch (shown.kind) {
      case "loading":
        return <Spinner style={{ width: "1.5em", margin: "12px auto", display: "block" }} />;
      case "retry":
        return retry(shown.message);
      case "notice":
        return <StateRow view={view} label={shown.label} text={shown.text} />;
      case "ready":
        return <Layouts layouts={shown.layouts} view={view} />;
      case "off":
        return null;
    }
  }

  function retry(text: string) {
    return (
      <PanelSectionRow>
        <Field
          focusable
          {...focusTarget(view, "retry")}
          className="wowdeck-layout-retry"
          label={loading ? "Loading…" : "Retry"}
          description={<span style={{ ...descriptionStyle, color: STEAM.danger }}>{text}</span>}
          onClick={() => {
            if (!loading) {
              retried.current = true;
              void refresh();
            }
          }}
        />
      </PanelSectionRow>
    );
  }
}

/**
 * A catalogue with nothing to list, as a row focus can reach (G3): the
 * pane would otherwise hold no focus stop at all.
 */
function StateRow({ view, label, text }: { view: string; label: string; text?: string }) {
  return (
    <PanelSectionRow>
      <Field
        focusable
        {...focusTarget(view, "state")}
        className="wowdeck-layout-state"
        label={label}
        description={text && <span style={descriptionStyle}>{text}</span>}
      />
    </PanelSectionRow>
  );
}

function Note({ text }: { text: string }) {
  return (
    <PanelSectionRow>
      <div style={descriptionStyle}>{text}</div>
    </PanelSectionRow>
  );
}

function Layouts({ layouts, view }: { layouts: ControllerLayout[]; view: string }) {
  return (
    <>
      {/* What the player can do here, above the list it explains (S22). */}
      <Note text="Layouts the WoWDeck maintainers reviewed for WoW. WoWDeck can't apply these layouts yet." />
      {layouts.map((layout) => (
        <LayoutRow key={layout.id} layout={layout} view={view} />
      ))}
    </>
  );
}

function LayoutRow({ layout, view }: { layout: ControllerLayout; view: string }) {
  const row = layoutRow(layout);
  // A layout that isn't offered reads like a row Steam has switched off (S23).
  const muted = row.inactive ? { color: STEAM.textDisabled } : undefined;
  return (
    <PanelSectionRow>
      <Field
        focusable
        {...focusTarget(view, layout.id)}
        className="wowdeck-layout-row"
        label={
          <span
            style={{
              color: row.inactive ? STEAM.textDisabled : STEAM.text,
              fontSize: STEAM_FONT.body,
              lineHeight: STEAM_LINE.body,
              overflowWrap: "anywhere",
            }}
          >
            {row.title}
          </span>
        }
        description={
          <span style={{ ...descriptionStyle, ...muted, display: "block" }}>
            <FactLine facts={row.facts} />
            {row.note && (
              <span style={{ display: "block", marginTop: STEAM_LINE_GAP }}>{row.note}</span>
            )}
            {row.description && (
              <span
                style={{ display: "block", marginTop: STEAM_LINE_GAP, overflowWrap: "anywhere" }}
              >
                {row.description}
              </span>
            )}
          </span>
        }
      />
    </PanelSectionRow>
  );
}
