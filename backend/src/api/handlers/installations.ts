/** RPC handlers: The installation list (InstallationService). */

import type { HandlerTable } from "../../bridge/jsonl";
import type { AddonService } from "../../wow/addons/AddonService";
import type { SteamLaunchLog } from "../../wow/installation/SteamLaunchLog";
import type { InstallationService } from "../../wow/installation/InstallationService";
import { getClientTypeForGameType } from "../../wow/utils/gametype";

/** What the installation handlers use. */
export interface InstallationsDeps {
  installationService: Pick<
    InstallationService,
    "update" | "listed" | "detect" | "recordLaunch" | "select" | "addManual" | "inspect" | "remove" | "list" | "require"
  >;
  service: Pick<AddonService, "recovery" | "retryRecovery" | "verifyRecovery">;
  steamLaunchLog: SteamLaunchLog;
  /** The home installation detection scans. */
  homeDir: string;
}

export function installationsHandlers({ installationService, service, homeDir, steamLaunchLog }: InstallationsDeps) {
  return {
    "installations.update": async (params) => ({ installation: installationService.update(params.installationId, params) }),

    "installations.list": async () => ({ installations: installationService.listed() }),

    "installations.detect": async () => ({ installations: await installationService.detect(homeDir) }),

    "installations.recordLaunch": async (params) => installationService.recordLaunch(homeDir, params),

    "installations.watchLaunch": async ({ running, ...launch }) => {
      await steamLaunchLog.update(launch, running);
      return {};
    },

    "installations.select": async (params) => ({ installation: installationService.select(params.installationId) }),

    "installations.add": async (params) => ({
      installations: await installationService.addManual(params.path, {
        displayName: params.displayName,
        clientType: params.clientType === undefined ? undefined : getClientTypeForGameType(params.clientType),
      }),
    }),

    "installations.inspect": async (params) => ({ found: await installationService.inspect(params.path) }),

    "installations.remove": async (params) => {
      await installationService.remove(params.installationId);
      return { installationId: params.installationId };
    },

    "installations.recoveryStatus": async () => ({
      installations: installationService.list().map((i) => service.recovery.status(i.id)),
      stateFile: service.recovery.stateFile(),
    }),

    "installations.recoveryDetails": async (params) =>
      service.recovery.details(installationService.require(params.installationId)),

    "installations.retryRecovery": async (params) => service.retryRecovery(params.installationId),

    "installations.verifyRecovery": async (params) => service.verifyRecovery(params.installationId),
  } satisfies Partial<HandlerTable>;
}
