import { Field, Focusable, PanelSectionRow, Spinner, quickAccessControlsClasses } from "@decky/ui";
import { toaster } from "@decky/api";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { engine } from "../engineLink";
import { openNativePreview } from "../nativeLayoutPreview";
import { PREVIEW_ONLY_REASON } from "../nativeControllerLayouts";
import {
  ControllerGlyph,
  InfoIcon,
  controllerTypeNumber,
  layoutRowClasses,
  useWorkshopLikes,
} from "../steamControllerUi";
import { layoutOperationContext, steamAccount } from "../controllerLayoutPreviewSession";
import {
  layoutApplyStatus,
  layoutRecovery,
  retryLayoutRestore,
} from "../controllerLayoutRecoverySession";
import { Warning, WarningLine } from "./Warning";
import { addonSession } from "../session";
import {
  layoutTargetPicks,
  linkedLayoutTargets,
  possibleSharedTargets,
  selectedLayoutTarget,
} from "../controllerLayoutTargets";
import { settingsStore } from "../settings";
import { useResource } from "../useResource";
import { listSteamShortcuts, type SteamGame } from "../steamLibrary";
import {
  forgetFocus,
  registerFocusElement,
  requestFocus,
  rememberedFocus,
  revealRemembered,
} from "../focusMemory";
import { layoutRow, useControllerLayoutCatalogue } from "../controllerLayouts";
import { useControllerLayoutsSourceOn } from "../controllerLayoutsSource";
import { FocusSlot, focusTarget } from "./FocusSlot";
import { SEGMENT_LABEL, SegmentMenu } from "./SegmentMenu";
import { PANE_DROPDOWN_VALUE } from "./dropdownValue";
import { FactLine } from "./FactLine";
import {
  STEAM,
  STEAM_FONT,
  STEAM_LINE,
  STEAM_LINE_GAP,
  STEAM_ROW_GAP,
  descriptionStyle,
} from "../steamTheme";
import type { ControllerLayout } from "../../backend/src/api/contracts";

/**
 * The Controller layouts destination's pane (GLOSSARY: Controller layouts
 * destination): the reviewed catalogue in the maintainers' order, with no
 * search, sorting or browse bar. A dropdown above the list chooses the
 * layout target (GLOSSARY), and A on a layout opens Steam's own preview for it.
 * Each layout is one focus stop (S14) that keeps its place (S21), read the
 * way Steam's controller-layout browser reads one: the title at 16/20 px,
 * then author and controller, then the description. The rows are Steam's
 * own QAM `Field`s (G3, S3), whose padding and 2 px radius stand in for the
 * native browser's 8 px card padding at the pane's width, 6 px apart as the
 * native rows are.
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
  return (
    <>
      <RecoveryPane view={view} />
      <CatalogueBody catalogue={catalogue} view={view} />
    </>
  );
}

function RecoveryPane({ view }: { view: string }) {
  const state = useResource(layoutRecovery, "current");
  const op = state.data?.operation;
  useEffect(() => {
    if (op) revealRemembered(view);
  }, [view, op?.id]);
  if (state.loading && !op)
    return (
      <PanelSectionRow>
        <Field label="Checking previous controls…" />
      </PanelSectionRow>
    );
  if (state.error)
    return (
      <PanelSectionRow>
        <Field label="Couldn't read previous controls" description={state.error} />
      </PanelSectionRow>
    );
  if (!op || op.phase === "failed" || op.phase === "restored") return null;
  const available =
    !op.nativeOwner && !!op.recoveryId && ["succeeded", "recovery-required"].includes(op.phase);
  return (
    <PanelSectionRow>
      <Field
        focusable
        {...focusTarget(view, "layout-recovery")}
        label={
          op.phase === "succeeded" ? "Restore previous controls" : "Previous controls need recovery"
        }
        description={
          <Warning
            heading={
              state.data?.restoreFailed
                ? "Couldn't restore previous controls"
                : op.phase === "succeeded"
                  ? "Previous controls are retained"
                  : "Couldn't confirm previous controls"
            }
          >
            <WarningLine text="Restoration needs the same account, controller and shared entries. If Steam can't establish them, your saved controls stay retained." />
          </Warning>
        }
        onOKActionDescription={available ? "Restore" : undefined}
        onClick={
          available
            ? async () => {
                let restored = false;
                try {
                  await retryLayoutRestore(op, () => addonSession.get().selectedId ?? "");
                  const after = await engine.rpc("controllerLayouts.operationStatus", {});
                  restored = after?.id === op.id && after.phase === "restored";
                  if (restored) layoutApplyStatus.clear();
                } catch {
                  /* resource reports read failures; native failure retains recovery */
                } finally {
                  layoutRecovery.invalidate();
                }
                toaster.toast({
                  title: "Controller Layouts",
                  body: restored
                    ? "Previous controls restored."
                    : "Couldn't restore previous controls. They stay saved; try again later.",
                });
                // The restore row disappears; land on the layout that was applied.
                const layoutId = op.approved.provenance?.layoutId;
                if (layoutId) requestFocus(view, layoutId);
              }
            : undefined
        }
      />
    </PanelSectionRow>
  );
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
    if (
      key !== undefined &&
      key !== "layout-recovery" &&
      key !== "layout-target" &&
      !keys.includes(key)
    ) {
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

/**
 * The list's headline, drawn with Steam's own QAM section title class, the
 * one Decky's `PanelSection title` uses. The pane already sits inside a
 * `PanelSection`, so a nested one would add its padding twice. The A action
 * is named in the footer ("Preview"), so the headline needs no help text.
 */
function Heading({ text }: { text: string }) {
  return <div className={quickAccessControlsClasses?.PanelSectionTitle}>{text}</div>;
}

/**
 * The layout target for the selected installation: the linked entries
 * (`linkedLayoutTargets`) and the one chosen, the player's remembered pick
 * or the default.
 */
function useLayoutTarget() {
  const session = useSyncExternalStore(addonSession.subscribe, addonSession.get);
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  useSyncExternalStore(layoutTargetPicks.subscribe, layoutTargetPicks.get);
  const games = listSteamShortcuts();
  const accountId = useResource(steamAccount, "current").data ?? undefined;
  const installationId = session.selectedId ?? "";
  const active = session.installations.find((i) => i.id === session.selectedId);
  const targets = linkedLayoutTargets(games, settings, active, accountId);
  return {
    games,
    installationId,
    choices: targets.choices,
    selected: selectedLayoutTarget(targets, installationId),
    accountId,
  };
}

function Layouts({ layouts, view }: { layouts: ControllerLayout[]; view: string }) {
  const { games, installationId, choices, selected, accountId } = useLayoutTarget();
  const [cached, setCached] = useState<string[]>([]);
  const shas = layouts.map((l) => l.revision?.sha256).filter((s): s is string => !!s);
  useEffect(() => {
    if (!accountId) return;
    let live = true;
    engine
      .rpc("controllerLayouts.cached", { accountId, sha256s: shas })
      .then((r) => live && setCached(r.cached))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [accountId, shas.join()]);
  return (
    <>
      <LayoutTargetRow
        view={view}
        choices={choices}
        selected={selected}
        onPick={(appId) => layoutTargetPicks.pick(installationId, appId)}
      />
      {selected && (
        <TargetWarning target={selected} games={games} installationId={installationId} />
      )}
      <Heading text="Reviewed layouts" />
      {/* Steam's 6 px between rows (S10): the Fields alone touched (0 px, DEVICE 2026-11-17). */}
      <div style={{ display: "flex", flexDirection: "column", gap: STEAM_ROW_GAP }}>
        {layouts.map((layout) => (
          <LayoutRow
            key={layout.id}
            layout={layout}
            view={view}
            target={selected?.appId}
            cached={!!layout.revision && cached.includes(layout.revision.sha256)}
          />
        ))}
      </div>
    </>
  );
}

/**
 * The layout target dropdown: the in-pane segment menu of the browse bar
 * (G14), its caption above it as there. With nothing linked, a row says
 * where to link the game instead, so the pane still opens on a focus stop.
 */
function LayoutTargetRow({
  view,
  choices,
  selected,
  onPick,
}: {
  view: string;
  choices: SteamGame[];
  selected: SteamGame | undefined;
  onPick: (appId: number) => void;
}) {
  if (!selected)
    return (
      <PanelSectionRow>
        <Field
          focusable
          {...focusTarget(view, "layout-target")}
          label="No linked game"
          description={
            <span style={descriptionStyle}>
              Choose World of Warcraft in Steam under Options › Steam library to preview layouts
            </span>
          }
        />
      </PanelSectionRow>
    );
  return (
    <PanelSectionRow>
      {/* The open list is placed against this box, as in the browse bar. */}
      <div style={{ position: "relative" }}>
        <FocusSlot view={view} id="layout-target">
          <div style={SEGMENT_LABEL}>Library entry</div>
          <SegmentMenu
            menuLabel="Library entry"
            choices={choices.map((g) => ({ data: g.appId, label: g.name }))}
            selected={selected.appId}
            renderValue={PANE_DROPDOWN_VALUE}
            onPick={onPick}
          />
        </FocusSlot>
      </div>
    </PanelSectionRow>
  );
}

/**
 * The warning line under the dropdown (S38), shown only when needed: the
 * entry shares controls with same-named entries, or WoWDeck can only
 * preview for it, with the reason. Read per layout target and installation,
 * as Apply reads it again. Nothing shows while it is read: most entries
 * need no warning, and a placeholder would make every pane jump (S26).
 */
function TargetWarning({
  target,
  games,
  installationId,
}: {
  target: SteamGame;
  games: SteamGame[];
  installationId: string;
}) {
  const scope = useResource(layoutOperationContext, `${target.appId}|${installationId}`);
  if (!scope.data && !scope.error) return null;
  const established = scope.data?.scope.state === "established";
  const others =
    (established ? scope.data!.scope.targets : possibleSharedTargets(games, target.appId)).length -
    1;
  const sharing = `Shares controls with ${others} other ${others === 1 ? "entry" : "entries"} named “${target.name}”`;
  if (established)
    return others < 1 ? null : (
      <PanelSectionRow>
        <Warning heading={sharing}>
          <WarningLine text="Applying a layout changes them all." />
        </Warning>
      </PanelSectionRow>
    );
  return (
    <PanelSectionRow>
      <Warning heading="Preview only">
        <WarningLine text={scope.error ?? scope.data?.scope.reason ?? PREVIEW_ONLY_REASON} />
        {others > 0 && <WarningLine text={`${sharing}.`} />}
      </Warning>
    </PanelSectionRow>
  );
}

function LayoutRow({
  layout,
  view,
  target,
  cached,
}: {
  layout: ControllerLayout;
  view: string;
  target?: number;
  cached: boolean;
}) {
  const row = layoutRow(layout);
  const cls = layoutRowClasses();
  const likes = useWorkshopLikes(layout.publishedFileId);
  const [opening, setOpening] = useState(false);
  const preview = async () => {
    if (target === undefined) return;
    setOpening(true);
    const error = await openNativePreview(layout, target);
    setOpening(false);
    if (error) toaster.toast({ title: layout.title, body: error });
  };
  // Nothing to preview for without a layout target.
  const noPreview = row.inactive || target === undefined;
  if (!cls)
    return <FallbackRow layout={layout} view={view} onPreview={noPreview ? undefined : preview} />;
  const focus = focusTarget(view, layout.id);
  return (
    // The slot is the wrapper around Steam's Focusable (DEVICE 2026-11-17:
    // registered as a plain element it never matched, so restores failed).
    <div ref={(el) => registerFocusElement(view, layout.id, el, true)}>
      <Focusable
        className={cls.ConfigurationButton}
        style={row.inactive ? { opacity: 0.5 } : undefined}
        noFocusRing
        preferredFocus={focus.preferredFocus}
        onGamepadFocus={focus.onGamepadFocus}
        onActivate={noPreview || opening ? undefined : preview}
        onOKButton={noPreview || opening ? undefined : preview}
        onOKActionDescription={noPreview ? undefined : opening ? "Preparing…" : "Preview"}
      >
        <div className={cls.IconContainer}>
          <ControllerGlyph type={controllerTypeNumber(layout.controllerType)} />
        </div>
        <div className={cls.TextRows}>
          <div className={cls.TextRow}>
            <div className={cls.Author}>{layout.author}</div>
            <div className={cls.Stretch} />
            {row.note ? (
              <div className={cls.InfoSection}>
                <span>{row.note}</span>
              </div>
            ) : (
              <>
                <div className={cls.InfoSection}>
                  <InfoIcon name={cached ? "downloaded" : "notDownloaded"} />
                  <span>{opening ? "Preparing…" : cached ? "Downloaded" : "Not downloaded"}</span>
                </div>
                {likes !== undefined && (
                  <div className={cls.InfoSection} aria-label={`${likes} likes`}>
                    <InfoIcon name="likes" />
                    <span>{likes}</span>
                  </div>
                )}
              </>
            )}
          </div>
          <div className={cls.ConfigTitleRow}>
            <div className={`${cls.TextRow} ${cls.Title}`}>{layout.title}</div>
          </div>
          {layout.description && (
            <div className={`${cls.TextRow} ${cls.Description}`}>{layout.description}</div>
          )}
        </div>
      </Focusable>
    </div>
  );
}

/** Steam without the community row classes: the plain row, still previewing natively. */
function FallbackRow({
  layout,
  view,
  onPreview,
}: {
  layout: ControllerLayout;
  view: string;
  onPreview?: () => void;
}) {
  const row = layoutRow(layout);
  const muted = row.inactive ? { color: STEAM.textDisabled } : undefined;
  return (
    <PanelSectionRow>
      <Field
        focusable
        {...focusTarget(view, layout.id)}
        className="wowdeck-layout-row"
        onClick={onPreview}
        onOKActionDescription={onPreview ? "Preview" : undefined}
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
