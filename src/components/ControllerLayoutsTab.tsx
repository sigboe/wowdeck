import { Field, Focusable, PanelSectionRow, Spinner } from "@decky/ui";
import { toaster } from "@decky/api";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { engine } from "../engineLink";
import { openNativePreview } from "../nativeLayoutPreview";
import {
  ControllerGlyph,
  InfoIcon,
  controllerTypeNumber,
  layoutRowClasses,
  useWorkshopStats,
} from "../steamControllerUi";
import {
  layoutPreviewSession,
  layoutOperationContext,
  layoutTargetContext,
  previewChoice,
} from "../controllerLayoutPreviewSession";
import {
  layoutApplyStatus,
  layoutRecovery,
  retryLayoutRestore,
} from "../controllerLayoutRecoverySession";
import { Warning, WarningLine } from "./Warning";
import { addonSession } from "../session";
import { layoutTargets, possibleSharedTargets } from "../controllerLayoutTargets";
import { useResource } from "../useResource";
import { listSteamShortcuts } from "../steamLibrary";
import { forgetFocus, rememberedFocus, revealRemembered } from "../focusMemory";
import { layoutRow, useControllerLayoutCatalogue } from "../controllerLayouts";
import { useControllerLayoutsSourceOn } from "../controllerLayoutsSource";
import { focusTarget } from "./FocusSlot";
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
 * search, sorting or browse bar. A opens the read-only preview pane.
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
  const chosen = useSyncExternalStore(previewChoice.subscribe, previewChoice.get);
  if (!sourceOn) {
    return null;
  }
  return (
    <>
      <RecoveryPane view={view} />
      {chosen ? (
        <PreviewPane choice={chosen} view={view} />
      ) : (
        <CatalogueBody catalogue={catalogue} view={view} />
      )}
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
                try {
                  await retryLayoutRestore(op, () => addonSession.get().selectedId ?? "");
                  layoutApplyStatus.clear();
                } catch {
                  /* resource reports read failures; native failure retains recovery */
                } finally {
                  layoutRecovery.invalidate();
                }
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
    if (key !== undefined && key !== "layout-recovery" && !keys.includes(key)) {
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
  const session = useSyncExternalStore(addonSession.subscribe, addonSession.get);
  const games = listSteamShortcuts();
  const account = useResource(layoutTargetContext, games.length ? String(games[0].appId) : null);
  const active = session.installations.find((i) => i.id === session.selectedId);
  const preferred = layoutTargets(games, active, account.data?.accountId).preferred;
  const accountId = account.data?.accountId;
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
      {/* What the player can do here, above the list it explains (S22). */}
      <Note
        text={
          preferred
            ? `Layouts the WoWDeck maintainers reviewed for WoW. A previews one in Steam for ${preferred.name}; X there applies it.`
            : "Layouts the WoWDeck maintainers reviewed for WoW. Choose a library entry to preview one in Steam."
        }
      />
      {/* Steam's 6 px between rows (S10): the Fields alone touched (0 px, DEVICE 2026-11-17). */}
      <div style={{ display: "flex", flexDirection: "column", gap: STEAM_ROW_GAP }}>
        {layouts.map((layout) => (
          <LayoutRow
            key={layout.id}
            layout={layout}
            view={view}
            target={preferred?.appId}
            cached={!!layout.revision && cached.includes(layout.revision.sha256)}
          />
        ))}
      </div>
    </>
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
  const stats = useWorkshopStats(layout.publishedFileId);
  const [opening, setOpening] = useState(false);
  const preview = async () => {
    if (target === undefined) {
      previewChoice.select(layout);
      return;
    }
    setOpening(true);
    const error = await openNativePreview(layout, target);
    setOpening(false);
    if (error) toaster.toast({ title: layout.title, body: error });
  };
  const choose = () => previewChoice.select(layout, undefined, true);
  if (!cls) return <FallbackRow layout={layout} view={view} onPreview={preview} />;
  const focus = focusTarget(view, layout.id);
  return (
    <div ref={focus.ref}>
      <Focusable
        className={cls.ConfigurationButton}
        style={row.inactive ? { opacity: 0.5 } : undefined}
        noFocusRing
        preferredFocus={focus.preferredFocus}
        onGamepadFocus={focus.onGamepadFocus}
        onActivate={row.inactive || opening ? undefined : preview}
        onOKButton={row.inactive || opening ? undefined : preview}
        onOKActionDescription={row.inactive ? undefined : opening ? "Preparing…" : "Preview"}
        onSecondaryButton={row.inactive ? undefined : choose}
        onSecondaryActionDescription={row.inactive ? undefined : "Library entry"}
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
                {stats?.likes !== undefined && (
                  <div className={cls.InfoSection} aria-label={`${stats.likes} likes`}>
                    <InfoIcon name="likes" />
                    <span>{stats.likes}</span>
                  </div>
                )}
                {stats?.hours !== undefined && (
                  <div className={cls.InfoSection}>
                    <InfoIcon name="hours" />
                    <span>
                      {stats.hours === 1 ? "1 hour played" : `${stats.hours} hours played`}
                    </span>
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
  onPreview: () => void;
}) {
  const row = layoutRow(layout);
  const muted = row.inactive ? { color: STEAM.textDisabled } : undefined;
  return (
    <PanelSectionRow>
      <Field
        focusable
        {...focusTarget(view, layout.id)}
        className="wowdeck-layout-row"
        onClick={row.inactive ? undefined : onPreview}
        onOKActionDescription={row.inactive ? undefined : "Preview"}
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

function PreviewPane({
  choice,
  view,
}: {
  choice: NonNullable<ReturnType<typeof previewChoice.get>>;
  view: string;
}) {
  const result = useResource(layoutPreviewSession.resource, choice.key);
  const session = useSyncExternalStore(addonSession.subscribe, addonSession.get);
  const games = listSteamShortcuts();
  const account = useResource(layoutTargetContext, games.length ? String(games[0].appId) : null);
  const active = session.installations.find((i) => i.id === session.selectedId);
  const scope = useResource(
    layoutOperationContext,
    choice.target !== undefined && session.selectedId
      ? `${choice.target}|${session.selectedId}`
      : null,
  );
  const context = scope.data?.scope.state === "established" ? scope.data : undefined;
  const preferred = layoutTargets(games, active, account.data?.accountId).preferred;
  useEffect(() => {
    if (!choice.key && !choice.correcting && preferred)
      previewChoice.select(choice.layout, preferred.appId);
  }, [choice, preferred?.appId]);
  useEffect(() => {
    revealRemembered(view);
  }, [view, choice.key]);
  const back = () => previewChoice.select(null);
  const row = (label: string, description?: string, onClick?: () => void, key = label) => (
    <PanelSectionRow key={key}>
      <Field
        focusable
        {...focusTarget(view, `preview:${choice.layout.id}:${key}`)}
        label={label}
        description={description}
        onClick={onClick}
        onCancelButton={() => {
          back();
          return true;
        }}
        onCancelActionDescription="Back"
        onOKActionDescription={onClick ? "Choose" : undefined}
      />
    </PanelSectionRow>
  );
  return (
    <>
      <PanelSectionRow>
        <Field
          focusable
          {...focusTarget(view, choice.layout.id)}
          label="Back to layouts"
          onClick={back}
        />
      </PanelSectionRow>
      {row(
        choice.layout.title,
        context
          ? "Preview the mappings, then apply. Your previous controls are saved first."
          : "Preview only. Your controls stay in place.",
      )}
      {choice.target !== undefined && (
        <>
          {row(
            "Selected library entry",
            games.find((g) => g.appId === choice.target)?.name ?? "Entry no longer available",
          )}
          {row("Change library entry", "Choose a different entry without renaming it", () =>
            previewChoice.select(choice.layout, undefined, true),
          )}
          {context ? (
            row("Shared controls", context.scope.targets.map((g) => g.name).join(", "))
          ) : (
            <>
              {row(
                "Possibly shared controls",
                possibleSharedTargets(games, choice.target)
                  .map((g) => g.name)
                  .join(", "),
              )}
              {row(
                "Applying unavailable",
                scope.loading
                  ? "Checking which entries share these controls…"
                  : "WoWDeck applies layouts only over your own saved controls on the built-in controller, without a controller-specific override. Preview remains available.",
              )}
            </>
          )}
        </>
      )}
      {!choice.key ? (
        <>
          {row(
            "Choose a library entry",
            "Entries with the same name may share controls. This preview changes none of them.",
          )}
          {games.length === 0 &&
            row(
              "No library entries available",
              "Open Steam's controller settings for your controller, then try again.",
            )}
          {games.map((game) =>
            row(
              game.name,
              `Library entry ${games.indexOf(game) + 1}`,
              () => previewChoice.select(choice.layout, game.appId),
              String(game.appId),
            ),
          )}
        </>
      ) : result.error ? (
        row("Couldn't preview the layout", result.error)
      ) : result.data?.state === "error" ? (
        row("Couldn't preview the layout", result.data.message)
      ) : result.data?.state === "ready" ? (
        <>
          {row(
            "Preview in Steam",
            "Shows how this layout maps to your controller. X there applies it.",
            async () => {
              const error = await openNativePreview(choice.layout, choice.target!);
              if (error) toaster.toast({ title: choice.layout.title, body: error });
            },
          )}
        </>
      ) : (
        row("Preparing preview…")
      )}
    </>
  );
}
