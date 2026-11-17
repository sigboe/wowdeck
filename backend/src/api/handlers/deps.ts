/**
 * Everything the RPC handlers are built from; engine.ts constructs it once.
 * Each handler module types the subset it uses (AddonsDeps, WtfDeps, ...),
 * so a test hands a handler only what it reads.
 */

import type { AddonService } from "../../wow/addons/AddonService";
import type { Catalogue } from "../../wow/catalogue/Catalogue";
import type { InstallationService } from "../../wow/installation/InstallationService";
import type { CompanionSyncCoordinator } from "../../wow/notifications/CompanionSync";
import type { AddonUpdates } from "../../wow/addons/AddonUpdates";
import type { UpdateToastGate } from "../../wow/notifications/UpdateToastGate";
import type { PluginUpdateCheck } from "../../wow/notifications/PluginUpdateCheck";
import type { UpdateStager } from "../../wow/plugin/UpdateStager";
import type { PrBuildList } from "../../wow/plugin/PrBuildList";
import type { ProviderRegistry } from "../../wow/providers/provider-registry";
import type { CurseForgeAuthService } from "../../wow/providers/curseforge/CurseForgeKeyAuth";
import type { CurseForgeProvider } from "../../wow/providers/curseforge/CurseForgeProvider";
import type { StateStore } from "../../wow/storage/StateStore";
import type { WtfBackupService } from "../../wow/wtf/WtfBackupService";
import type { WtfJobRunner, WtfJobTarget } from "../../wow/wtf/WtfJobRunner";
import type { RecentErrorsBuffer } from "../../diagnostics/RecentErrors";
import type { About } from "../../about/About";
import type { ControllerLayoutCatalogueSource } from "../../wow/controllerLayouts/ControllerLayoutCatalogue";

export interface HandlerDeps {
  launch: import("../../wow/launch/LaunchService").LaunchService;
  tsmData: import("../../wow/tsm/TradeSkillMasterData").TradeSkillMasterData;
  tsmAuth: import("../../wow/tsm/TradeSkillMasterAuth").TradeSkillMasterAuth;
  backendVersion: string;
  homeDir: string;
  store: StateStore;
  registry: ProviderRegistry;
  service: AddonService;
  /** Search, Latest/Popular, details and finding sources (read-only). */
  catalogue: Catalogue;
  installationService: InstallationService;
  companionCoordinator: CompanionSyncCoordinator;
  /** The update check, eligibility, Update all and automatic updates. */
  addonUpdates: AddonUpdates;
  updateToastGate: UpdateToastGate;
  /** WoWDeck's own update notice (system.updateCheck). */
  pluginUpdate: PluginUpdateCheck;
  /** Stages the newer release for Decky's installer (system.updateStage). */
  updateStager: UpdateStager;
  /** The published PR builds (system.listPrBuilds). */
  prBuilds: PrBuildList;
  curseForgeAuth: CurseForgeAuthService;
  curseForgeProvider: CurseForgeProvider;
  wtfService: WtfBackupService;
  wtfJobs: WtfJobRunner;
  /** The WTF job target for an installation. */
  wtfJobTarget: (installationId: string) => WtfJobTarget;
  recentErrors: RecentErrorsBuffer;
  /** Options › About (about.get). */
  about: About;
  /** The Controller layouts catalogue (controllerLayouts.catalogue). */
  controllerLayouts: ControllerLayoutCatalogueSource;
  controllerLayoutOperations: import("../../wow/controllerLayouts/ControllerLayoutOperations").ControllerLayoutOperations;
  controllerLayoutPreviews: import("../../wow/controllerLayouts/ControllerLayoutPreviews").ControllerLayoutPreviews;
}
