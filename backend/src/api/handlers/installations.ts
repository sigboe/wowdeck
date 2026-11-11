/** RPC handlers: The installation list (InstallationService). */

import type { JsonlServer } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";
import { getClientTypeForGameType } from "../../wow/utils/gametype";

export function register(server: JsonlServer, { installationService, service, updateCheck, homeDir }: HandlerDeps): void {
  server.on("installations.update", async (params) => ({ installation: installationService.update(params.installationId, params) }));

  server.on("installations.list", async () => ({ installations: installationService.listed() }));

  server.on("installations.detect", async () => {
    const installations = await installationService.detect(homeDir);
    // A newly discovered installation has no update metadata yet: check
    // every installation, fire-and-forget so the RPC isn't held up by every
    // installation's provider calls.
    void updateCheck.checkAll();
    return { installations };
  });

  server.on("installations.select", async (params) => ({ installation: installationService.select(params.installationId) }));

  server.on("installations.add", async (params) => {
    const installations = await installationService.addManual(params.path, {
      displayName: params.displayName,
      clientType: params.clientType === undefined ? undefined : getClientTypeForGameType(params.clientType),
    });
    // Same reasoning as installations.detect above.
    void updateCheck.checkAll();
    return { installations };
  });

  server.on("installations.inspect", async (params) => ({ found: await installationService.inspect(params.path) }));

  server.on("installations.remove", async (params) => {
    await installationService.remove(params.installationId);
    return { installationId: params.installationId };
  });

  server.on("installations.recoveryStatus", async () => ({
    installations: installationService.list().map((i) => service.recovery.status(i.id)),
    stateFile: service.recovery.stateFile(),
  }));

  server.on("installations.recoveryDetails", async (params) =>
    service.recovery.details(installationService.require(params.installationId)),
  );

  server.on("installations.retryRecovery", async (params) => service.retryRecovery(params.installationId));

  server.on("installations.verifyRecovery", async (params) => service.verifyRecovery(params.installationId));
}
