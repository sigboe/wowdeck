import { Focusable } from "@decky/ui";
import { optionsUpdateDirection } from "../updatePanelNavigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CurseForgeAuthStatus, Installation } from "../types";
import { engine } from "../engineLink";
import { settingsStore } from "../settings";
import { sourcesStore } from "../sourcesStore";
import { diagnosticsStore } from "../diagnosticsStore";
import { useRestoreFocus } from "./FocusSlot";
import { WtfBackupSection } from "./WtfBackupSection";
import { VIEW } from "./settings/common";
import { InstallationsSection, type InstallationsSession } from "./settings/InstallationsSection";
import { AddonListSection } from "./settings/AddonListSection";
import { SourcesSection } from "./settings/SourcesSection";
import { UpdatesSection } from "./settings/UpdatesSection";
import { SteamLibrarySection } from "./settings/SteamLibrarySection";
import { NotificationsSection } from "./settings/NotificationsSection";
import { AboutSection } from "./settings/AboutSection";

interface Props {
  installations: Installation[];
  selectedId: string | null;
  /** The addon session: installation writes and installs go through it. */
  session: InstallationsSession;
  /** Focus the last used row again on mount (guide S21). */
  restoreRows: boolean;
}

/**
 * Options: one component per section (./settings/). Sections own their state;
 * what two sections share is loaded here: the providers (the sources store,
 * shared with Get Addons) and the CurseForge auth status (Sources'
 * CurseForge row and its key modal read and change both) and the diagnostics (Notifications
 * reads the companion status from them). The section order is the focus
 * order (FocusRow ids, guide S21).
 */
export function SettingsView({ installations, selectedId, session, restoreRows }: Props) {
  useRestoreFocus(VIEW, restoreRows);
  const { providers } = useSyncExternalStore(sourcesStore.subscribe, sourcesStore.get);
  // Not `providers[…].configured`: that is true for either key, and the
  // CurseForge row must tell the bundled key from the user's own
  // (curseForgeAuthUi.ts).
  const [curseForgeAuth, setCurseForgeAuth] = useState<CurseForgeAuthStatus | null>(null);
  // Module scope (diagnosticsStore.ts): a WowUp Companion install finishes
  // after its modal has remounted the panel (guide G4).
  const { diagnostics } = useSyncExternalStore(diagnosticsStore.subscribe, diagnosticsStore.get);

  useEffect(() => {
    // Again on every open: the last automatic update run changes meanwhile.
    void settingsStore.load();
    // Loaded eagerly purely so the Notifications section can show its own
    // quiet "companion not found" status — system.diagnostics is local-only
    // (no network calls), so this is cheap. The full diagnostics text stays
    // opt-in (About › Diagnostics reads them afresh into the same store).
    void diagnosticsStore.load();
  }, []);

  const reloadCurseForgeAuth = useCallback(async () => {
    try {
      setCurseForgeAuth(await engine.rpc("curseforge.authStatus"));
    } catch {
      // engine not ready
    }
  }, []);

  useEffect(() => {
    void reloadCurseForgeAuth();
  }, [reloadCurseForgeAuth]);

  const reloadProviders = useCallback(() => sourcesStore.load(), []);

  useEffect(() => {
    void reloadProviders();
  }, [reloadProviders]);

  const selected = installations.find((i) => i.id === selectedId) ?? null;

  // Steam settings rows (guide S14, S19): one row per setting, label plus one
  // short description, the control on the right; long text lives in descriptions.
  return (
    <Focusable onGamepadDirection={optionsUpdateDirection}>
      <InstallationsSection
        installations={installations}
        selectedId={selectedId}
        session={session}
      />
      <AddonListSection installations={installations} selectedId={selectedId} />
      <WtfBackupSection installation={selected} />
      <SourcesSection
        providers={providers}
        reloadProviders={reloadProviders}
        curseForgeAuth={curseForgeAuth}
        onCurseForgeKeyChanged={async () => {
          await reloadProviders();
          await reloadCurseForgeAuth();
        }}
      />
      <UpdatesSection />
      <SteamLibrarySection />
      <NotificationsSection diagnostics={diagnostics} installation={selected} />
      <AboutSection />
    </Focusable>
  );
}
