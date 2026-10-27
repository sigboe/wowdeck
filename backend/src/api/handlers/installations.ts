/** RPC handlers: The installation list (InstallationService). */

import type { JsonlServer } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";
import type { WowInstallation } from "../../wow/models";
import {
  getClientFullName,
  getClientTypeForGameType,
  getClientTypeLabel,
  getGameTypeForClientType,
} from "../../wow/utils/gametype";

export function register(server: JsonlServer, { service, installationService, updateCheck, homeDir }: HandlerDeps): void {
  server.on("installations.list", async () => ({
    installations: installationService.list().map(wireInstallation),
  }));

  server.on("installations.detect", async () => {
    const installations = await installationService.detect(homeDir);
    // A newly discovered installation has no update metadata yet: check
    // every installation, fire-and-forget so the RPC isn't held up by every
    // installation's provider calls.
    void updateCheck.checkAll();
    return { installations: installations.map(wireInstallation) };
  });

  server.on("installations.select", async (params) => {
    const installation = installationService.select(params.installationId);
    return { installation: installation ? wireInstallation(installation) : null };
  });

  server.on("installations.add", async (params) => {
    const installations = await installationService.addManual(params.path, {
      displayName: params.displayName,
      clientType: params.clientType === undefined ? undefined : getClientTypeForGameType(params.clientType),
    });
    // Same reasoning as installations.detect above.
    void updateCheck.checkAll();
    return { installations: installations.map(wireInstallation) };
  });

  server.on("installations.inspect", async (params) => ({
    found: (await installationService.inspect(params.path)).map((i) => ({
      gameType: getGameTypeForClientType(i.clientType),
      displayName: i.displayName,
    })),
  }));

  server.on("installations.remove", async (params) => {
    await installationService.remove(params.installationId);
    return { installationId: params.installationId };
  });

  function wireInstallation(i: WowInstallation) {
    const selectedId = installationService.selectedId();
    return {
      id: i.id,
      gameType: getGameTypeForClientType(i.clientType),
      path: i.location,
      addonsPath: service.addonsPathFor(i),
      displayName: i.displayName,
      clientName: getClientTypeLabel(i.clientType),
      clientFullName: getClientFullName(i.clientType),
      source: i.source ?? "detected",
      selected: i.id === selectedId,
      version: i.version ?? null,
    };
  }
}
