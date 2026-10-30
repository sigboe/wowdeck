/** RPC handlers: Addons: list, check, search, browse, install, update, rollback, import/export. */

import type { JsonlServer } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";
import { settle } from "../../bridge/jsonl";
import { channelFromWire } from "../../wow/addons/releaseChannel";
import { NotFoundError } from "../../wow/errors";
import { runningFileManager, showItems } from "../../desktop/FileManager";

export function register(server: JsonlServer, { service, catalogue, installationService, updateCheck }: HandlerDeps): void {
  server.on("addons.list", async () => {
    const installation = installationService.require();
    return { addons: await service.listAddons(installation) };
  });

  server.on("addons.refresh", async (params) => updateCheck.refresh(installationService.require(params.installationId)));

  server.on("addons.folders", async (params) => {
    const installation = installationService.require();
    const [{ addonsPath, folders }, fileManager] = await Promise.all([
      service.addonFolders(installation, params.addonId),
      runningFileManager(),
    ]);
    return { addonsPath, folders, fileManager };
  });

  server.on("addons.showFolders", async (params) => {
    const installation = installationService.require();
    const { folders } = await service.addonFolders(installation, params.addonId);
    const onDisk = folders.filter((f) => f.present).map((f) => f.path);
    if (onDisk.length === 0) {
      throw new NotFoundError("addon folders for", params.addonId);
    }
    return showItems(onDisk);
  });

  server.on("addons.search", async (params) => {
    const installation = installationService.require();
    return catalogue.search(params.query, installation, params.providerId);
  });

  // Never-throws (contracts.ts Settled): every failure, "no installation
  // selected" included, is part of the answer, so require() runs inside.
  server.on("addons.resolveUrlImport", async (params) =>
    settle(() => catalogue.resolveUrlImport(params.url, installationService.require())),
  );

  server.on("addons.inspectArchive", async (params) =>
    settle(() => service.inspectArchive(params.path, installationService.require())),
  );

  server.on("discover.latest", async (params) => {
    const installation = installationService.require();
    return catalogue.discover("latest", params.providerId, installation, params.index, params.pageSize);
  });

  server.on("discover.popular", async (params) => {
    const installation = installationService.require();
    return catalogue.discover(
      "popular",
      params.providerId,
      installation,
      params.index,
      params.pageSize,
      params.categoryId,
    );
  });

  server.on("addons.getDescription", async (params) => {
    const description = await catalogue.getDescription(params.providerId, params.externalId);
    return { description };
  });

  server.on("addons.getChangelog", async (params) => {
    const installation = installationService.require();
    const changelog = await catalogue.getChangelog(params.providerId, params.externalId, installation);
    return { changelog };
  });

  server.on("addons.updateSummary", async (params) => ({ installations: await updateCheck.updateSummary(params.refresh === true) }));

  server.on("addons.rollback", async (params) => service.rollback(params.addonId));

  server.on("addons.setAutoUpdatePaused", async (params) => ({
    addon: await service.setAutoUpdatePaused(params.addonId, params.paused === true),
  }));

  server.on("rollback.status", async () => service.rollbackStatus());

  server.on("rollback.clear", async () => service.clearRollback());

  server.on("addons.lookup", async (params) => {
    const installation = installationService.require();
    return { addons: await service.lookup(params.providerId, params.externalIds, installation) };
  });

  server.on("addons.getCategories", async (params) => {
    const installation = installationService.require();
    const categories = await catalogue.getCategories(params.providerId, installation);
    return { categories };
  });

  server.on("addons.install", async (params) =>
    service.install({
      intent: "install",
      providerId: params.providerId,
      externalId: params.externalId,
      installation: installationService.require(),
      channel: params.channel === undefined ? undefined : channelFromWire(params.channel),
    }),
  );

  server.on("addons.setChannel", async (params) => service.setChannel(params.addonId, channelFromWire(params.channel)));

  server.on("addons.reinstall", async (params) => service.reinstall(params.addonId));

  server.on("addons.remove", async (params) => {
    const operation = await service.removeAddon(params.addonId);
    return { addonId: params.addonId, operation };
  });

  server.on("addons.removeUnmanaged", async (params) => {
    const installation = installationService.require(params.installationId);
    const operation = await service.removeUnmanagedFolder(installation, params.folderName);
    return { operation };
  });

  server.on("addons.findSources", async (params) => {
    const request =
      "addonId" in params
        ? await service.sourceRequestForAddon(params.addonId)
        : await service.sourceRequestForFolder(installationService.require(), params.folderName);
    return catalogue.findSources(request);
  });

  server.on("addons.changeSource", async (params) =>
    service.changeSource(params.addonId, params.providerId, params.externalId),
  );

  server.on("addons.adopt", async (params) =>
    service.adopt(installationService.require(), params.folderName, params.providerId, params.externalId),
  );

  server.on("addons.setIgnored", async (params) => ({ addon: await service.setIgnored(params.addonId, params.ignored) }));

  server.on("addons.update", async (params) => service.updateAddon(params.addonId));

  server.on("addons.updateAll", async (params) => ({
    operations: params.allInstallations
      ? await updateCheck.updateAllInstallations()
      : await service.updateAll(installationService.require()),
  }));

  server.on("addons.export", async (params) => {
    const installation = installationService.require(params.installationId);
    return service.portability.export(installation);
  });

  server.on("addons.previewImport", async (params) => {
    const installation = installationService.require(params.installationId);
    return service.portability.preview(params.importString, installation);
  });

  server.on("addons.importAddonList", async (params) => {
    const installation = installationService.require(params.installationId);
    // Each installed addon already fires the normal addonsChanged/
    // operationResult events through install() itself (same companion-data
    // regen and My Addons refresh every other install path gets).
    return service.importAddonList(params.importString, installation);
  });
}
