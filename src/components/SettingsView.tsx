import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CurseForgeAuthStatus, Installation } from "../types";
import * as api from "../services/backend";
import { settingsStore } from "../settings";
import { loadSources, sourcesStore } from "../sourcesStore";
import { diagnosticsStore, loadDiagnostics } from "../diagnosticsStore";
import { useRestoreFocus } from "./FocusSlot";
import { WtfBackupSection } from "./WtfBackupSection";
import { VIEW } from "./settings/common";
import { InstallationsSection } from "./settings/InstallationsSection";
import { AddonListSection } from "./settings/AddonListSection";
import { SourcesSection } from "./settings/SourcesSection";
import { UpdatesSection } from "./settings/UpdatesSection";
import { SteamLibrarySection } from "./settings/SteamLibrarySection";
import { NotificationsSection } from "./settings/NotificationsSection";
import { AboutSection } from "./settings/AboutSection";

interface Props {
  installations: Installation[];
  selectedId: string | null;
  /** Reload installations + addons after structural changes. */
  onChanged: () => Promise<void>;
  /** Focus the last used row again on mount (guide S21). */
  restoreRows: boolean;
}

/**
 * Options: one component per section (./settings/). Sections own their state;
 * what two sections share is loaded here: the providers (the sources store,
 * shared with Get Addons) and the CurseForge auth status (Addon sources'
 * CurseForge row and its key modal read and change both) and the diagnostics (Notifications
 * reads the companion status from them). The section order is the focus
 * order (FocusRow ids, guide S21).
 */
export function SettingsView({ installations, selectedId, onChanged, restoreRows }: Props) {
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
    void loadDiagnostics(api.rpc);
  }, []);

  const reloadCurseForgeAuth = useCallback(async () => {
    try {
      setCurseForgeAuth(await api.rpc("curseforge.authStatus"));
    } catch {
      // engine not ready
    }
  }, []);

  useEffect(() => {
    void reloadCurseForgeAuth();
  }, [reloadCurseForgeAuth]);

  const reloadProviders = useCallback(() => loadSources(api.rpc), []);

  useEffect(() => {
    void reloadProviders();
  }, [reloadProviders]);

  const selected = installations.find((i) => i.id === selectedId) ?? null;

  // Steam settings rows (guide S14, S19): one row per setting, label plus one
  // short description, the control on the right; long text lives in descriptions.
  return (
    <>
      <InstallationsSection
        installations={installations}
        selectedId={selectedId}
        onChanged={onChanged}
      />
      <AddonListSection
        installations={installations}
        selectedId={selectedId}
        onChanged={onChanged}
      />
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
      <NotificationsSection
        diagnostics={diagnostics}
        installation={selected}
        onChanged={onChanged}
      />
      <AboutSection />
    </>
  );
}
