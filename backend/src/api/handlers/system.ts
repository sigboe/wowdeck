/** RPC handlers: Status and diagnostics. */

import type { JsonlServer } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";
import { PROTOCOL_VERSION } from "../contracts";

export function register(server: JsonlServer, { store, registry, service, installationService, companionCoordinator, curseForgeAuth, recentErrors, backendVersion, pluginUpdate, updateStager }: HandlerDeps): void {
  server.on("system.getStatus", async () => ({
    backendVersion: backendVersion,
    protocolVersion: PROTOCOL_VERSION,
    pid: process.pid,
  }));

  server.on("system.updateCheck", async () => pluginUpdate.checkOnce());

  server.on("system.updateStage", async () => updateStager.stage());

  server.on("system.diagnostics", async () => ({
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
