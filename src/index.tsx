import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ButtonItem,
  DropdownItem,
  Field,
  Focusable,
  GamepadButton,
  PanelSection,
  PanelSectionRow,
  type GamepadEvent,
} from "@decky/ui";
import { definePlugin } from "@decky/api";
import { FaBoxOpen, FaDiceD6, FaSearch, FaCog } from "react-icons/fa";
import * as api from "./services/backend";
import { InstalledView } from "./components/InstalledView";
import { GetAddonsTab as GetAddonsBrowseTab } from "./components/GetAddonsTab";
import { SettingsView } from "./components/SettingsView";
import { TopNav, type NavTab } from "./components/TopNav";
import { SelfUpdatePanel } from "./components/SelfUpdatePanel";
import { wowdeckSharedStyleCss } from "./sharedStyles";
import { leaveBrowseSession, subscribeWidening, widening } from "./browseSessionState";
import { pluginToast } from "./toast";
import { selfUpdateStore } from "./selfUpdate";
import { pluginUpdateDot } from "./pluginUpdate";
import { addonSession } from "./session";
import { askUntilAnswered } from "./askUntilAnswered";
import { QAM_TABS, QAM_VIEW, qamState, type QamTab } from "./qamState";
import { startSourceJump } from "./optionsJump";
import { CURSE_KEY_ROW } from "./components/settings/common";
import { FocusRow } from "./components/FocusSlot";
import { QAM_DROPDOWN_BELOW_VALUE } from "./components/dropdownValue";
import { STEAM_NO_TRANSFORM_SCROLL, useScrollBuffer } from "./components/ScrollBuffer";
import { handleWtfEvent } from "./wtfBackupState";
import { wtfCompletedToast } from "./wtfText";
import { patchGamePage } from "./steamGamePage";
import { autoUpdateText } from "./steamLibrary";
import { settingsStore } from "./settings";
import { loadSummary } from "./steamUpdates";
import { startHomeBadge } from "./steamDom/homeBadge";
import { startPluginExitWatch, startQamVisibilityWatch } from "./steamDom/qamVisibility";
import { setQamExpander, stopQamWidening } from "./steamDom/qamWidening";
import { QamExpandHook } from "./steamDom/qamExpandHook";
import { registerShoulderNav } from "./shoulderNav";
// Decky's plugin name (plugin.json); Decky's state identifies the active plugin by it.
import { name as PLUGIN_NAME } from "../plugin.json";
import type { StatusInfo } from "./types";

type Tab = QamTab;

function Content() {
  // Module scope (qamState.ts): the panel unmounts for every modal, dropdown
  // menu and file picker (G4), and must come back on the same tab.
  const [tab, setTabRaw] = useState<Tab>(qamState.tab);
  const setTab = (next: Tab) => {
    // Leaving Get Addons (L1/R1 bumper or the tab bar, spec story 7) slides
    // the QAM closed: the widened mode collapses on the way out so the next
    // landing is collapsed on the nav bar (spec story 8). Modal round-trips
    // leave qamState.tab alone, so they keep the widened mode (G4).
    if (qamState.tab === "browse" && next !== "browse") {
      leaveBrowseSession();
    }
    qamState.tab = next;
    setTabRaw(next);
  };
  // Like Steam's Tabs: switching with L1/R1 (or coming back after a modal)
  // returns focus to the row last used on that tab; picking a tab on the tab
  // bar itself leaves focus on the tab bar.
  const [restoreRows, setRestoreRows] = useState(true);
  // Get Addons entered by L1/R1 lands on its Installation row (PC-04); entered
  // from the tab bar, focus stays on the bar. A remount (modal round-trip)
  // starts false, so it never pulls focus away from where the user was.
  const bumperEntry = useRef(false);
  // Widened mode (Get Addons) is module state owned by the widening service;
  // the tab bar mirrors it to stay at its collapsed width instead of
  // stretching across the widened panel.
  const [wide, setWide] = useState(widening.wide);
  useEffect(() => subscribeWidening(setWide), []);
  // Valve's scroll buffer below Decky's sticky title, re-measured on every
  // focus move (guide S21).
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedTabRef = useRef<HTMLDivElement>(null);
  const remeasureScroll = useScrollBuffer(rootRef, { attach: true });
  // Module scope (addonSession.ts): the panel unmounts for every menu (G4).
  const { addons, loads, installations, selectedId } = useSyncExternalStore(
    addonSession.subscribe,
    addonSession.get,
  );
  const [engineOk, setEngineOk] = useState<boolean | null>(null);
  // Set when the bridge reports this machine has no engine at all: no
  // amount of retrying helps, so the panel says so instead (no Retry).
  const [unsupported, setUnsupported] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      let status: StatusInfo;
      try {
        // A panel opened while Decky reloads the plugin asks the old Python
        // side, which never answers (askUntilAnswered.ts).
        status = await askUntilAnswered(api.getStatus, { timeoutMs: 5000, attempts: 3 });
      } catch {
        // Show the "couldn't start" retry state, not a blank panel.
        setEngineOk(false);
        return;
      }
      if (status.ok) {
        setEngineOk(true);
        await addonSession.reloadAll();
        return;
      }
      if (status.code === "unsupported_architecture") {
        // The bridge's message already names the machine (e.g. "WoWDeck
        // doesn't run on riscv64 devices.").
        setUnsupported(status.message || "WoWDeck doesn't run on this device.");
        return;
      }
      setEngineOk(false);
    })();
  }, []);

  // backend events -> refresh addon list when operations complete.
  //
  // Deliberately does not also toast on "operation.completed"/
  // "operation.failed" directly: OperationResult never carries an
  // addon name, only `addonId` (its internal UUID), so a toast built
  // from it here could only ever show an unreadable id. Every action
  // (addonActions.ts) already awaits its own call and shows its own
  // correctly-named toast.
  useEffect(() => {
    return api.onBackendEvent((event) => {
      if (event.event === "addons.changed") {
        addonSession.addonsChanged(event.params.addonIds);
      }
    });
  }, []);

  // Terminology and icons match WowUp's own sidebar nav (wowup-electron
  // VerticalTabsComponent: My Addons = fas:dice-d6, Get Addons =
  // fas:magnifying-glass, Options = fas:gear) rather than guessed
  // glyphs — measured pre-rework (see git history).
  // L1/R1 the way Steam's own tab bars take them (guide S15): as gamepad
  // button events through the focus tree, so they only act while focus is in
  // this panel. Plugin tab navigation clamps (UI-02 ticket 04, spec story
  // 8: "both clamp") like the friends nav does — no wrap past the edges.
  const stepTab = (direction: -1 | 1) => {
    const i = QAM_TABS.indexOf(qamState.tab);
    const next = Math.min(Math.max(i + direction, 0), QAM_TABS.length - 1);
    setRestoreRows(true);
    bumperEntry.current = true;
    setTab(QAM_TABS[next]!);
  };
  const onButtonDown = (evt: GamepadEvent) => {
    const button = evt.detail.button;
    if (button !== GamepadButton.BUMPER_LEFT && button !== GamepadButton.BUMPER_RIGHT) {
      return;
    }
    evt.preventDefault();
    evt.stopPropagation();
    stepTab(button === GamepadButton.BUMPER_LEFT ? -1 : 1);
  };
  // L1/R1 also work while focus is outside our content (PC-10): on Decky's
  // title-bar back button, or nowhere yet right after the plugin opens. Those
  // presses never reach the root's onButtonDown, so they are read from Steam's
  // controller input (shoulderNav.ts); inside our content the root handles them.
  const stepTabRef = useRef(stepTab);
  stepTabRef.current = stepTab;
  useEffect(() => {
    const outside = (direction: -1 | 1) => {
      const root = rootRef.current;
      if (root && !root.contains(root.ownerDocument.activeElement)) {
        stepTabRef.current(direction);
      }
    };
    return registerShoulderNav(
      () => outside(-1),
      () => outside(1),
    );
  }, []);

  // Options carries the update dot while a WoWDeck release is available,
  // like the panel's Update button it leads to (same shared state).
  const selfUpdate = useSyncExternalStore(selfUpdateStore.subscribe, selfUpdateStore.get);
  const tabs: NavTab[] = [
    { id: "installed", label: "My Addons", icon: <FaDiceD6 /> },
    { id: "browse", label: "Get Addons", icon: <FaSearch /> },
    { id: "settings", label: "Options", icon: <FaCog />, dot: pluginUpdateDot(selfUpdate.info) },
  ];

  if (unsupported !== null) {
    // A device WoWDeck has no engine for: retrying cannot help, so there is
    // no Retry button — just the message naming why (the architecture).
    return (
      <PanelSection>
        <PanelSectionRow>
          <Field label="This device isn't supported" description={unsupported} />
        </PanelSectionRow>
      </PanelSection>
    );
  }

  if (engineOk === false) {
    return (
      <PanelSection>
        <PanelSectionRow>
          <Field
            label="WoWDeck Addon Manager couldn't start"
            description="Try again. If it keeps happening, restart your Steam Deck."
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => window.location.reload()}>
            Retry
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <Focusable
      ref={rootRef}
      className="wowdeck-root wowdeck-scroll-buffer"
      onButtonDown={onButtonDown}
      onGamepadFocus={remeasureScroll}
      {...STEAM_NO_TRANSFORM_SCROLL}
    >
      <style>{wowdeckSharedStyleCss()}</style>
      {/* The tab bar and view-wide pickers float under Decky's title while the
          list scrolls under them (guide S24); the scroll buffer counts them. */}
      <div className="wowdeck-float-pane">
        <TopNav
          tabs={tabs}
          activeId={tab}
          compact={wide}
          selectedRef={selectedTabRef}
          onSelect={(id) => {
            setRestoreRows(false);
            bumperEntry.current = false;
            setTab(id as Tab);
          }}
        />
        {tab === "installed" && installations.length > 1 && (
          // A QAM row needs Steam's row context (PanelSectionRow via FocusRow):
          // it sets --field-negative-horizontal-margin, which keeps the label
          // and the dropdown 16 px inside the row's focus highlight. In a plain
          // div both touched the highlight's edges (guide S27; DEVICE audit).
          <div style={{ padding: "0 16px 8px" }}>
            <FocusRow view={QAM_VIEW.installed} id="installation">
              <DropdownItem
                // No label: the button is the whole row (owner, 2026-10-23).
                menuLabel="Installation"
                rgOptions={installations.map((i) => ({ data: i.id, label: i.displayName }))}
                selectedOption={selectedId}
                onChange={(option) => void addonSession.selectInstallation(option.data as string)}
                childrenContainerWidth="max"
                renderButtonValue={QAM_DROPDOWN_BELOW_VALUE}
                bottomSeparator="none"
              />
            </FocusRow>
          </div>
        )}
        {tab === "settings" && <SelfUpdatePanel />}
      </div>

      {tab === "installed" && (
        <>
          <InstalledView
            addons={addons}
            loading={loads > 0}
            restoreRows={restoreRows}
            multipleInstallations={installations.length > 1}
          />
        </>
      )}
      {tab === "browse" && (
        <GetAddonsBrowseTab
          installations={installations}
          selectedId={selectedId}
          onSelectInstallation={addonSession.selectInstallation}
          landOnInstallation={bumperEntry.current}
          onExitToNav={() => selectedTabRef.current?.focus()}
          onOpenSources={(providers, marked) => {
            // The zero-capability screen's button: Options opens on the first
            // marked source row that can take focus. A source that still needs
            // setup cannot take it, so the key row is the fallback (optionsJump.ts).
            // Nothing is enabled here. With nothing compatible to mark, Options
            // still opens (sources are turned on there) through the normal
            // focus restore.
            if (marked.length > 0) {
              const needsSetup = providers.some(
                (p) => marked.includes(p.id) && p.requiresApiKey && !p.configured,
              );
              startSourceJump(marked, providers, needsSetup ? CURSE_KEY_ROW : undefined);
            }
            setRestoreRows(true);
            bumperEntry.current = false;
            setTab("settings");
          }}
        />
      )}
      {tab === "settings" && (
        <SettingsView
          installations={installations}
          selectedId={selectedId}
          onSelect={addonSession.selectInstallation}
          onChanged={addonSession.reloadAll}
          restoreRows={restoreRows}
        />
      )}
    </Focusable>
  );
}

/**
 * The "updates available" toast is never tied to My Addons' own
 * navigation lifecycle — opening/leaving/returning to My Addons must
 * not re-trigger it. The backend (UpdateToastGate) owns the actual
 * decision — whether the setting is on, whether a day has actually
 * passed, and the toast's words — so this just asks and shows the
 * toast it gets, if any. Safe to call liberally;
 * most calls return `toast: null` immediately without any
 * backend network work at all.
 */
async function checkUpdateToast(): Promise<void> {
  try {
    const { toast } = await api.rpc("notifications.checkUpdateToast");
    if (toast) {
      pluginToast(toast.title, toast.body);
    }
  } catch {
    // Engine not ready yet, or the RPC failed — silently skip. The next
    // trigger (a later wake-from-sleep, or the next plugin load) tries
    // again; nothing is lost since the backend only records a check as
    // "done" once it actually completes one.
  }
}

export default definePlugin(() => {
  console.log("wowdeck frontend initializing");

  // Widened mode has a native half the QAM window cannot reach: Steam moves
  // the QAM view itself while its placeholder carries Steam's `Expanded`
  // class (see steamDom/qamExpandHook.tsx). Patch the QAM renderer once per
  // load and hand the service the hook.
  const qamExpand = new QamExpandHook();
  qamExpand.init();
  setQamExpander(qamExpand);

  // Once per plugin load (Decky startup, reload, update): Content() remounts
  // on every modal and tab switch (guide G4), so the toast is not tied to it.
  void checkUpdateToast();
  // WoWDeck's own release check too — the engine's daily cap decides whether
  // it costs a request, so waking the Deck is a useful trigger as well.
  void selfUpdateStore.refresh({ toast: true, bypassWindow: true });

  // WTF backup/restore jobs run in the engine and outlive any panel or modal, so their
  // progress/outcome events are subscribed once per plugin load into a module-scope
  // store (wtfBackupState.ts), not in a component that a modal would unmount.
  const offWtfEvents = api.onBackendEvent((event) => {
    handleWtfEvent(event);
    if (event.event === "wtf.completed") {
      const toast = wtfCompletedToast(event.params);
      if (toast) {
        pluginToast(toast.title, toast.body);
      }
    }
  });
  // WF-02: an automatic update runs in the engine while nothing of ours may
  // be open; say what it did, and refresh the Steam band and badge.
  const offAutoUpdate = api.onBackendEvent((event) => {
    if (event.event !== "addons.autoUpdated") {
      return;
    }
    const text = autoUpdateText(event.params.result);
    if (text) {
      pluginToast(text.title, text.body);
    }
    void loadSummary();
  });

  // BEYOND-05: the addons section on the linked WoW entry's game page (the
  // linked game comes from the settings store, which Options updates).
  const unpatchGamePage = patchGamePage();
  // ...and the badge on its home tile.
  const stopHomeBadge = startHomeBadge();
  // A QAM close must end the browse session, so reopening lands Get Addons
  // collapsed (UI-02 story 33): the module-scope machine alone would carry a
  // widened mode into the reopened QAM. Watched here, at plugin-load scope,
  // because the panel unmounts when the QAM closes (G4) and no component
  // would be there to collapse it.
  const stopQamVisibilityWatch = startQamVisibilityWatch();
  // Leaving our plugin (Decky's title-bar Back, B to the plugin list) ends it
  // too: that unmount looks like a modal round-trip unless Decky's active
  // plugin is checked.
  const stopPluginExitWatch = startPluginExitWatch(PLUGIN_NAME);
  void settingsStore.load();

  // Both notifications also run on wake: an engine session can last weeks on
  // a Deck that sleeps, so the daily cap — not the session — decides whether
  // a check actually happens. SteamClient.System (or this method) is missing
  // on some Steam builds, and an unguarded call would throw in definePlugin's
  // factory and nothing would render.
  let resumeRegistration: { unregister(): void } | null = null;
  if (typeof SteamClient?.System?.RegisterForOnResumeFromSuspend === "function") {
    resumeRegistration = SteamClient.System.RegisterForOnResumeFromSuspend(() => {
      void checkUpdateToast();
      void selfUpdateStore.refresh({ toast: true, bypassWindow: true });
    });
  } else {
    console.log(
      "wowdeck: SteamClient.System.RegisterForOnResumeFromSuspend not available on this Steam Client build; update notifications fall back to plugin-load only",
    );
  }

  return {
    name: PLUGIN_NAME,
    // Like Steam's own QAM titles ("Quick Settings", "Notifications"): one
    // short line, never wrapped (guide S25). The plugin list keeps the full
    // name. Decky draws the title bar itself (TitleView: the Title class, the
    // back button, then this) and gives a plugin without a titleView a plain
    // `<div style={{ flex: 0.9 }}>`; this is that same element, only with the
    // short name. A second Title class in here (as before, PC-02) applied the
    // bar's padding and height twice and put the text in the wrong place.
    // flex: 1 instead of Decky's 0.9: the 0.9 slot leaves the last 10% of the
    // bar unused and cut "WoWDeck Manager" by 11 px (DEVICE, CDP, 2026-10-25:
    // 207.5 px of text at 22 px/700 in a 196.2 px slot; at 1 the slot is
    // 218 px and flex: 2 measures the same, so 1 is the widest the bar allows).
    // The text then ends at the bar's 16 px padding — the gap Steam's own QAM
    // titles keep.
    titleView: (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        WoWDeck Manager
      </div>
    ),
    content: <Content />,
    icon: <FaBoxOpen />,
    onDismount() {
      offWtfEvents();
      offAutoUpdate();
      unpatchGamePage();
      stopHomeBadge();
      stopQamVisibilityWatch();
      stopPluginExitWatch();
      // The whole plugin is unloading (not a modal round-trip): the next
      // opening of Get Addons must land collapsed on the nav bar.
      leaveBrowseSession();
      // Steam's DOM outlives a plugin reload: a reload mid-widened must leave
      // no widened classes behind for the reloaded world to trip over.
      stopQamWidening();
      qamExpand.deinit();
      resumeRegistration?.unregister();
      console.log("wowdeck frontend unloading");
    },
  };
});
