import { useMemo, useRef, useSyncExternalStore } from "react";
import {
  DialogButton,
  Field,
  Focusable,
  Menu,
  MenuItem,
  MenuSeparator,
  PanelSection,
  PanelSectionRow,
  Spinner,
  ToggleField,
  showContextMenu,
} from "@decky/ui";
import { FaEllipsisH, FaFilter, FaSync } from "react-icons/fa";
import type { Addon, DetailsResult } from "../types";
import {
  addonActions,
  addonRowDescription,
  canQuickUpdate,
  isNeverTouched,
  filterAddons,
  isLibrary,
  isUnmanaged,
  removedAlong,
  rowQuickAction,
  sortAddons,
  type AddonActionId,
} from "../addonRow";
import { QamProgressBar } from "./QamProgressBar";
import { STEAM, descriptionStyle } from "../steamTheme";
import { QAM_VIEW } from "../qamState";
import { addonSession } from "../session";
import { settingsStore } from "../settings";
import { FocusSlot, focusTarget, useRefocusWhenLost, useRestoreFocus } from "./FocusSlot";
import { openAddonDetailsModal } from "./AddonDetailsModal";
import { openFoldersModal } from "./FoldersModal";
import { confirmRemoveAddon } from "./confirmRemove";
import { showChoiceMenu } from "./choiceMenu";
import { openFindSourceModal } from "./FindSourceModal";
import { openFilterAddonsModal } from "./FilterAddonsModal";
import { dependencyNote } from "../detailsHeader";
import { channelTag, followChannelChoices } from "../releaseChannel";

interface Props {
  addons: Addon[];
  loading: boolean;
  /** Focus the last used row again on mount (guide S21). */
  restoreRows: boolean;
  /** More than one installation: Update all offers "all installations" (WF-13). */
  multipleInstallations: boolean;
}

const VIEW = QAM_VIEW.installed;

/**
 * My Addons in Steam's list model (guide S14-S16): every addon is ONE focus
 * stop, a native QAM row (Field) with name, provider and version. A opens
 * Details, X updates when an update is offered, and the Menu button (or the
 * on-screen ⋯ for touch) opens Steam's context menu with every action. This
 * replaces the four-button rows and the fixed-column/MAINTAIN_X navigation they
 * needed. Not yet verified on a Deck.
 */
export function InstalledView({ addons, loading, restoreRows, multipleInstallations }: Props) {
  useRestoreFocus(VIEW, restoreRows);
  // Module scope (addonSession.ts): a context menu or modal unmounts the
  // panel (G4) while the action it started keeps running.
  const { busy, updatingAll, showIgnored, filter } = useSyncExternalStore(
    addonSession.subscribe,
    addonSession.get,
  );
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const showLibraries = !settings.hideLibraries;
  const showUnmanaged = !settings.hideUnmanaged;

  const updates = useMemo(() => addons.filter((a) => canQuickUpdate(a)), [addons]);
  const shown = useMemo(
    () =>
      addons.filter(
        (a) =>
          (showIgnored || !a.ignored) &&
          (showLibraries || !isLibrary(a)) &&
          (showUnmanaged || !isUnmanaged(a)),
      ),
    [addons, showIgnored, showLibraries, showUnmanaged],
  );
  const visible = useMemo(() => sortAddons(filterAddons(shown, filter)), [shown, filter]);

  const topRef = useRef<HTMLDivElement | null>(null);
  useRefocusWhenLost(VIEW, topRef);

  const { actions } = addonSession;

  const openChannelMenu = (addon: Addon, afterPick?: () => void) => {
    const current = addon.channel ?? "stable";
    showChoiceMenu("Release channel", followChannelChoices(), current, (c) => {
      afterPick?.();
      // The marked channel is already followed: nothing to install.
      if (c !== current) {
        void actions.setChannel(addon, c);
      }
    });
  };

  /** Reuses the Get Addons Details view; Install there means Update for an installed addon. */
  const openDetails = (addon: Addon) => {
    const result: DetailsResult = {
      providerId: addon.providerId ?? "",
      externalId: addon.externalId ?? "",
      name: addon.name,
      author: addon.author,
      downloadCount: null,
      summary: addon.notes,
      thumbnailUrl: addon.thumbnailUrl,
      websiteUrl: addon.externalUrl,
      latestVersion: addon.availableVersion ?? addon.version,
      gameVersion: addon.gameVersion,
      releasedAt: null,
      channel: null,
      screenshots: [],
    };
    openAddonDetailsModal({
      result,
      installLabel: addon.updateAvailable ? "Update" : null,
      onInstall: () => actions.update(addon),
      channelMenu: addon.canChangeChannel
        ? (afterPick) => openChannelMenu(addon, afterPick)
        : undefined,
      dependencies: dependencyNote({
        required: addon.dependencies,
        missing: addon.missingDependencies ?? [],
      }),
      relationships: {
        kind: "toc",
        items: addon.dependencies.map((name) => ({
          name,
          installed: !(addon.missingDependencies ?? []).includes(name),
        })),
      },
    });
  };

  const run = (addon: Addon, action: AddonActionId) => {
    switch (action) {
      case "update":
        void actions.update(addon);
        return;
      case "reinstall":
        void actions.reinstall(addon);
        return;
      case "details":
        openDetails(addon);
        return;
      case "folders":
        openFoldersModal(addon);
        return;
      case "channel":
        openChannelMenu(addon);
        return;
      case "rollback":
        void actions.rollback(addon);
        return;
      case "pauseAuto":
      case "resumeAuto":
        void actions.setAutoUpdatePaused(addon, action === "pauseAuto");
        return;
      case "ignore":
      case "unignore":
        void actions.setIgnored(addon, action === "ignore");
        return;
      case "findSource":
      case "changeSource":
        openFindSourceModal(addon, (source) => void actions.useSource(addon, source));
        return;
      case "remove":
        confirmRemoveAddon(
          addon.name,
          !!addon.providerId,
          () => actions.remove(addon),
          // The engine removes libraries nothing else needs (WF-22); say so first.
          removedAlong(addon, addons),
        );
        return;
    }
  };

  return (
    <>
      {/* Steam's row separator (10 % white), above the heading instead of on the
          floating pane, and below the toolbar above the first addon (owner). */}
      <div ref={topRef} style={SEPARATOR} />
      <PanelSection
        title={
          // A filter says so in the heading, not in an extra row (WF-06).
          filter
            ? `Installed (${visible.length} of ${addons.length})`
            : `Installed (${addons.length})`
        }
      >
        <PanelSectionRow>
          {updatingAll ? (
            <QamProgressBar
              indeterminate
              sOperationText={
                updatingAll === "all"
                  ? "Updating all installations…"
                  : `Updating ${updates.length} addon${updates.length === 1 ? "" : "s"}…`
              }
            />
          ) : (
            <Focusable flow-children="row" style={{ display: "flex", gap: "8px", margin: "4px 0" }}>
              <DialogButton
                style={{ minWidth: 0, width: "auto", flex: "none", padding: "10px 16px" }}
                disabled={loading}
                onClick={() => void addonSession.refreshFromProviders()}
                onOKActionDescription="Check for updates"
                {...focusTarget(VIEW, "refresh")}
              >
                {loading ? <Spinner style={{ width: "1em" }} /> : <FaSync />}
              </DialogButton>
              <DialogButton
                // Glyph only (owner): the filter lives in a dialog, and the
                // glyph turns Steam blue while one is on (WF-06).
                style={{
                  minWidth: 0,
                  width: "auto",
                  flex: "none",
                  padding: "10px 16px",
                  ...(filter ? { color: STEAM.primary } : {}),
                }}
                aria-label={filter ? `Filter: ${filter}` : "Filter"}
                onClick={() => openFilterAddonsModal(filter, addonSession.setFilter)}
                onOKActionDescription={filter ? `Filter: ${filter}` : "Filter"}
                {...(filter
                  ? {
                      onSecondaryButton: () => addonSession.setFilter(""),
                      onSecondaryActionDescription: "Show all",
                    }
                  : {})}
                {...focusTarget(VIEW, "filter")}
              >
                <FaFilter />
              </DialogButton>
              <DialogButton
                style={{ minWidth: 0, flex: 1 }}
                // Stays reachable with nothing to update here while ≡ can
                // still update the other installations.
                disabled={updates.length === 0 && !multipleInstallations}
                onClick={() => void actions.updateAll("installation")}
                {...(multipleInstallations
                  ? {
                      onMenuButton: () => void actions.updateAll("all"),
                      onMenuActionDescription: "Update all installations",
                    }
                  : {})}
                {...focusTarget(VIEW, "updateAll")}
              >
                {updates.length > 0 ? `Update all (${updates.length})` : "All up to date"}
              </DialogButton>
            </Focusable>
          )}
        </PanelSectionRow>
        <div style={{ ...SEPARATOR, margin: "4px 0 0" }} />

        {visible.length === 0 && !loading && (
          <PanelSectionRow>
            <div style={descriptionStyle}>
              {filter
                ? `No addons match “${filter}”. Change the filter to see more.`
                : "No addons yet. Find some in Get Addons."}
            </div>
          </PanelSectionRow>
        )}

        {visible.map((addon) => (
          <PanelSectionRow key={addon.id}>
            <AddonRow
              addon={addon}
              busy={!!busy[addon.id]}
              onAction={(action) => run(addon, action)}
            />
          </PanelSectionRow>
        ))}

        {addons.some((a) => isLibrary(a)) && (
          <PanelSectionRow>
            <FocusSlot view={VIEW} id="showLibraries">
              <ToggleField
                label="Show libraries"
                description={
                  <span style={descriptionStyle}>
                    Addons installed only because another needs them
                  </span>
                }
                checked={showLibraries}
                onChange={(on) => void settingsStore.save({ hideLibraries: !on })}
              />
            </FocusSlot>
          </PanelSectionRow>
        )}
        {addons.some((a) => isUnmanaged(a)) && (
          <PanelSectionRow>
            <FocusSlot view={VIEW} id="showUnmanaged">
              <ToggleField
                label="Show unmanaged addons"
                description={
                  <span style={descriptionStyle}>
                    Installed manually, so WoWDeck Addon Manager doesn&apos;t update them
                  </span>
                }
                checked={showUnmanaged}
                onChange={(on) => void settingsStore.save({ hideUnmanaged: !on })}
              />
            </FocusSlot>
          </PanelSectionRow>
        )}
        {addons.some((a) => a.ignored) && (
          <PanelSectionRow>
            <FocusSlot view={VIEW} id="showIgnored">
              <ToggleField
                label="Show ignored addons"
                checked={showIgnored}
                onChange={addonSession.setShowIgnored}
              />
            </FocusSlot>
          </PanelSectionRow>
        )}
      </PanelSection>
    </>
  );
}

const SEPARATOR = { height: "1px", background: "rgba(255, 255, 255, 0.1)", margin: "0 16px 12px" };

function AddonRow({
  addon,
  busy,
  onAction,
}: {
  addon: Addon;
  busy: boolean;
  onAction: (action: AddonActionId) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Pause/Resume and the PAUSED tag only mean something with auto-update on.
  const { autoUpdate } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get).settings;
  const memory = focusTarget(VIEW, `addon:${addon.id}`);
  const desc = addonRowDescription(addon);
  // Rows that are never updated read like a row that is switched off (S23).
  const greyed = addon.ignored || isUnmanaged(addon);
  const quick = rowQuickAction(addon);
  // A git checkout or Raider.IO client folder is listed for information only (no actions, no menu).
  const inert = isNeverTouched(addon);

  const openMenu = (target?: EventTarget | null) => {
    const actions = addonActions(addon, busy, autoUpdate);
    const destructiveAt = actions.findIndex((a) => a.tone === "destructive");
    showContextMenu(
      <Menu label={addon.name}>
        {actions.map((a, i) => [
          i === destructiveAt && i > 0 ? <MenuSeparator key={`sep-${a.id}`} /> : null,
          <MenuItem key={a.id} tone={a.tone} disabled={a.disabled} onClick={() => onAction(a.id)}>
            {a.label}
          </MenuItem>,
        ])}
      </Menu>,
      target ?? ref.current ?? window,
    );
  };

  return (
    <Field
      focusable
      preferredFocus={memory.preferredFocus}
      onGamepadFocus={memory.onGamepadFocus}
      ref={(el: HTMLDivElement | null) => {
        ref.current = el;
        memory.ref(el);
      }}
      label={
        // Ignored rows in Steam's disabled grey (guide S23): what Steam does to a
        // row that is switched off, plus a status tag so it reads at a glance.
        greyed ? <span style={{ color: STEAM.textDisabled }}>{addon.name}</span> : addon.name
      }
      description={
        <span
          style={greyed ? { ...descriptionStyle, color: STEAM.textDisabled } : descriptionStyle}
        >
          {addon.ignored && <span className="wowdeck-status-tag">Ignored</span>}
          {isUnmanaged(addon) && <span className="wowdeck-status-tag">Unmanaged</span>}
          {/* Its source is turned off or not set up: no checks, no updates. */}
          {addon.sourceOff && <span className="wowdeck-status-tag">Source off</span>}
          {isLibrary(addon) && <span className="wowdeck-status-tag">Library</span>}
          {addon.newlyUpdated && <span className="wowdeck-status-tag">Updated</span>}
          {autoUpdate && addon.autoUpdatePaused && (
            <span className="wowdeck-status-tag">Paused</span>
          )}
          {channelTag(addon.channel) && (
            <span className="wowdeck-status-tag">{channelTag(addon.channel)}</span>
          )}
          {desc.base}
          {desc.newVersion && <span style={{ color: STEAM.positive }}> → {desc.newVersion}</span>}
          {desc.flags && ` · ${desc.flags}`}
        </span>
      }
      onClick={inert ? undefined : () => (addon.providerId ? onAction("details") : openMenu())}
      onOKActionDescription={inert ? undefined : addon.providerId ? "Details" : "Options"}
      onSecondaryButton={quick && !busy ? () => onAction(quick.id) : undefined}
      onSecondaryActionDescription={quick?.label}
      onMenuButton={inert ? undefined : () => openMenu()}
      onMenuActionDescription={inert ? undefined : "Options"}
    >
      {inert ? null : busy ? (
        <Spinner style={{ width: "1.2em" }} />
      ) : (
        // Pointer/touch way into the same menu; not a focus stop of its own (S14).
        <DialogButton
          focusable={false}
          style={{ minWidth: 0, width: "auto", padding: "6px 12px" }}
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e.currentTarget);
          }}
        >
          <FaEllipsisH />
        </DialogButton>
      )}
    </Field>
  );
}
