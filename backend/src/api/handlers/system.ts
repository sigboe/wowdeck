/** RPC handlers: Status and diagnostics. */

import type { HandlerTable } from "../../bridge/jsonl";
import type { RecentErrorsBuffer } from "../../diagnostics/RecentErrors";
import type { InstallationService } from "../../wow/installation/InstallationService";
import type { CompanionSyncCoordinator } from "../../wow/notifications/CompanionSync";
import type { PluginUpdateCheck } from "../../wow/notifications/PluginUpdateCheck";
import type { PrBuildList } from "../../wow/plugin/PrBuildList";
import type { UpdateStager } from "../../wow/plugin/UpdateStager";
import type { CurseForgeAuthService } from "../../wow/providers/curseforge/CurseForgeKeyAuth";
import type { ProviderRegistry } from "../../wow/providers/provider-registry";
import type { StateStore } from "../../wow/storage/StateStore";
import type { TradeSkillMasterData } from "../../wow/tsm/TradeSkillMasterData";
import { PROTOCOL_VERSION, UPDATE_CHANNELS } from "../contracts";
import { ValidationError } from "../../wow/errors";
import { publicFields } from "../../wow/plugin/PrBuildList";

/** What the status and diagnostics handlers use. */
export interface SystemDeps {
  tsmData: Pick<TradeSkillMasterData, "diagnostics">;
  store: Pick<StateStore, "settings">;
  registry: Pick<ProviderRegistry, "providerInfos">;
  installationService: Pick<InstallationService, "require" | "summaries">;
  companionCoordinator: Pick<CompanionSyncCoordinator, "isCompanionInstalled">;
  curseForgeAuth: Pick<CurseForgeAuthService, "snapshot">;
  recentErrors: Pick<RecentErrorsBuffer, "list">;
  backendVersion: string;
  pluginUpdate: Pick<PluginUpdateCheck, "channel" | "check" | "setChannel">;
  updateStager: Pick<UpdateStager, "cancel" | "stage" | "stageListedPrBuild">;
  prBuilds: Pick<PrBuildList, "list">;
  homeDir: string;
}

export function systemHandlers({ tsmData, store, registry, installationService, companionCoordinator, curseForgeAuth, recentErrors, backendVersion, pluginUpdate, updateStager, prBuilds, homeDir }: SystemDeps) {
  return {
    "system.getStatus": async () => ({
      backendVersion: backendVersion,
      protocolVersion: PROTOCOL_VERSION,
      pid: process.pid,
      homeDir,
    }),

    "system.updateCheck": async (params) =>
      pluginUpdate.check({ notify: params.notify === true, force: params.force === true }),

    "system.getUpdateChannel": async () => ({ channel: pluginUpdate.channel() }),

    "system.setUpdateChannel": async (params) => {
      if (!UPDATE_CHANNELS.includes(params.channel)) {
        throw new ValidationError(`Unknown update channel: ${String(params.channel)}`);
      }
      return pluginUpdate.setChannel(params.channel);
    },

    "system.updateStage": async () => updateStager.stage(),

    // The modal's fields only: the zip's URL and checksum stay engine-side.
    "system.listPrBuilds": async () => {
      const builds = await prBuilds.list();
      return { builds: builds?.map(publicFields) ?? null };
    },

    // The zip's URL and checksum come from the list, read again by the
    // stager, never from the caller.
    "system.installPrBuild": async ({ number, version }) => updateStager.stageListedPrBuild(number, version),

    "system.cancelDownload": async () => ({ cancelled: updateStager.cancel() }),

    "system.diagnostics": async () => ({
      tradeSkillMaster: tsmData?.diagnostics(),
      backendVersion: backendVersion,
      protocolVersion: PROTOCOL_VERSION,
      platform: `${process.platform}-${process.arch}`,
      // decky-loader exports its own and the plugin's version as env vars
      // to every plugin process (main.py spawns this engine with
      // {...os.environ, ...}, so they arrive here unchanged) — null, not a
      // guess, when running outside that host.
      deckyVersion: process.env.DECKY_VERSION ?? null,
      pluginVersion: process.env.DECKY_PLUGIN_VERSION ?? null,
      // A quiet, on-demand way to see why no in-game popup appears —
      // companion detection is a local-only scan
      // (CompanionSyncCoordinator.isCompanionInstalled), never a network
      // call, so this stays cheap even though diagnostics is user-triggered.
      installations: await Promise.all(
        installationService.summaries().map(async (i) => ({
          ...i,
          companionAddonDetected: await companionCoordinator.isCompanionInstalled(installationService.require(i.id)),
        })),
      ),
      providers: registry.providerInfos(),
      recentErrors: recentErrors.list(),
      // Source/status only, never a key value.
      curseForgeAuth: curseForgeAuth.snapshot(),
      githubTokenConfigured: !!store.settings.githubAccessToken,
    }),
  } satisfies Partial<HandlerTable>;
}
