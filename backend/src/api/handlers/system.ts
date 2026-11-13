/** RPC handlers: Status and diagnostics. */

import type { JsonlServer } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";
import { PROTOCOL_VERSION, UPDATE_CHANNELS } from "../contracts";
import { ValidationError } from "../../wow/errors";
import { publicFields } from "../../wow/plugin/PrBuildList";

export function register(server: JsonlServer, { tsmData, store, registry, service, installationService, companionCoordinator, curseForgeAuth, recentErrors, backendVersion, pluginUpdate, updateStager, prBuilds, homeDir }: HandlerDeps): void {
  server.on("system.getStatus", async () => ({
    backendVersion: backendVersion,
    protocolVersion: PROTOCOL_VERSION,
    pid: process.pid,
    homeDir,
  }));

  server.on("system.updateCheck", async (params) =>
    pluginUpdate.check({ notify: params.notify === true, force: params.force === true }),
  );

  server.on("system.getUpdateChannel", async () => ({ channel: pluginUpdate.channel() }));

  server.on("system.setUpdateChannel", async (params) => {
    if (!UPDATE_CHANNELS.includes(params.channel)) {
      throw new ValidationError(`Unknown update channel: ${String(params.channel)}`);
    }
    return pluginUpdate.setChannel(params.channel);
  });

  server.on("system.updateStage", async () => updateStager.stage());

  // The modal's fields only: the zip's URL and checksum stay engine-side.
  server.on("system.listPrBuilds", async () => {
    const builds = await prBuilds.list();
    return { builds: builds?.map(publicFields) ?? null };
  });

  // The zip's URL and checksum come from the list, read again by the
  // stager, never from the caller.
  server.on("system.installPrBuild", async ({ number, version }) => updateStager.stageListedPrBuild(number, version));

  server.on("system.cancelDownload", async () => ({ cancelled: updateStager.cancel() }));

  server.on("system.diagnostics", async () => ({
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
      service.installationSummary().map(async (i) => ({
        ...i,
        companionAddonDetected: await companionCoordinator.isCompanionInstalled(installationService.require(i.id)),
      })),
    ),
    providers: registry.providerInfos(),
    recentErrors: recentErrors.list(),
    // Source/status only, never a key value.
    curseForgeAuth: curseForgeAuth.snapshot(),
    githubTokenConfigured: !!store.settings.githubAccessToken,
  }));
}
