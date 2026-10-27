/** What the RPC handler modules are built from; main.ts constructs it once. */

import type { AddonService } from "../../wow/addons/AddonService";
import type { Catalogue } from "../../wow/catalogue/Catalogue";
import type { InstallationService } from "../../wow/installation/InstallationService";
import type { CompanionSyncCoordinator } from "../../wow/notifications/CompanionSync";
import type { UpdateCheck } from "../../wow/notifications/UpdateCheck";
import type { UpdateToastGate } from "../../wow/notifications/UpdateToastGate";
import type { PluginUpdateCheck } from "../../wow/notifications/PluginUpdateCheck";
import type { UpdateStager } from "../../wow/plugin/UpdateStager";
import type { ProviderRegistry } from "../../wow/providers/provider-registry";
import type { CurseForgeAuthService } from "../../wow/providers/curseforge/CurseForgeKeyAuth";
import type { CurseForgeProvider } from "../../wow/providers/curseforge/CurseForgeProvider";
import type { StateStore } from "../../wow/storage/StateStore";
import type { WtfBackupService } from "../../wow/wtf/WtfBackupService";
import type { WtfJobRunner, WtfJobTarget } from "../../wow/wtf/WtfJobRunner";
import type { RecentErrorsBuffer } from "../../diagnostics/RecentErrors";

export interface HandlerDeps {
  backendVersion: string;
  homeDir: string;
  store: StateStore;
  registry: ProviderRegistry;
  service: AddonService;
  /** Search, Latest/Popular, details and finding sources (read-only). */
  catalogue: Catalogue;
  installationService: InstallationService;
  companionCoordinator: CompanionSyncCoordinator;
  updateCheck: UpdateCheck;
  updateToastGate: UpdateToastGate;
  /** WoWDeck's own update notice (system.updateCheck). */
  pluginUpdate: PluginUpdateCheck;
  /** Stages the newer release for Decky's installer (system.updateStage). */
  updateStager: UpdateStager;
  curseForgeAuth: CurseForgeAuthService;
  curseForgeProvider: CurseForgeProvider;
  wtfService: WtfBackupService;
  wtfJobs: WtfJobRunner;
  /** The WTF job target for an installation (the active one when no id). */
  wtfJobTarget: (installationId?: string) => WtfJobTarget;
  recentErrors: RecentErrorsBuffer;
}
