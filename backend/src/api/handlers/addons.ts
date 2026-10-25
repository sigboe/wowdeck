/** RPC handlers: Addons: list, check, search, browse, install, update, rollback, import/export. */

import type { JsonlServer } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";
import { errorCodeFor } from "../../bridge/jsonl";
import { channelFromWire } from "../../wow/addons/releaseChannel";
import { NotFoundError } from "../../wow/errors";
import { runningFileManager, showItems } from "../../desktop/FileManager";

export function register(server: JsonlServer, { service, installationService, updateCheck, companionCoordinator }: HandlerDeps): void {
  server.on("addons.list", async () => {
    const installation = installationService.require();
    return { addons: await service.listAddons(installation) };
  });

  server.on("addons.refresh", async (params) => {
    const installation = installationService.require(params.installationId);
    await service.scanInstallation(installation);
    const sync = await service.refresh(installation);
    const addons = await service.listAddons(installation);
    // This installation's metadata is already current from the refresh
    // just above — regen only, no second network pass, and scoped to
    // this one installation.
    void companionCoordinator.regenerate([installation.id]);
    return { addons, updated: sync.updated, failed: sync.failed };
  });

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
    const { results, providerErrors } = await service.search(params.query, installation, params.providerId);
    return { results, providerErrors };
  });

  server.on("addons.resolveUrlImport", async (params) => {
    // Every failure, "no installation selected" included, is a structured
    // { error } (contracts.ts), so require() is inside the try.
    try {
      const installation = installationService.require();
      const result = await service.resolveUrlImport(params.url, installation);
      return { result, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: null, error: { code: errorCodeFor(err), message } };
    }
  });

  server.on("addons.inspectArchive", async (params) => {
    // The never-throws envelope again: a missing, corrupt or empty
    // archive is an expected outcome of a picked file, not an RPC
    // failure (see addons.resolveUrlImport above).
    try {
      const installation = installationService.require();
      const result = await service.inspectArchive(params.path, installation);
      return { result, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: null, error: { code: errorCodeFor(err), message } };
    }
  });

  server.on("discover.latest", async (params) => {
    const installation = installationService.require();
    return service.discover("latest", params.providerId, installation, params.index, params.pageSize);
  });

  server.on("discover.popular", async (params) => {
    const installation = installationService.require();
    return service.discover(
      "popular",
      params.providerId,
      installation,
      params.index,
      params.pageSize,
      params.categoryId,
    );
  });

  server.on("addons.getDescription", async (params) => {
    const description = await service.getAddonDescription(params.providerId, params.externalId);
    return { description };
  });

  server.on("addons.getChangelog", async (params) => {
    const installation = installationService.require();
    const changelog = await service.getAddonChangelog(params.providerId, params.externalId, installation);
    return { changelog };
  });

  server.on("addons.updateSummary", async (params) => {
    if (params.refresh) {
      await updateCheck.checkAll();
    }
    return { installations: service.updateSummary() };
  });

  server.on("addons.rollback", async (params) => {
    const { addon, operation } = await service.rollback(params.addonId);
    return { addon: service.wire(addon), operation };
  });

  server.on("addons.setAutoUpdatePaused", async (params) => ({
    addon: service.wire(service.setAutoUpdatePaused(params.addonId, params.paused === true)),
  }));

  server.on("rollback.status", async () => service.rollbackStatus());

  server.on("rollback.clear", async () => service.clearRollback());

  server.on("addons.lookup", async (params) => {
    const installation = installationService.require();
    return { addons: await service.lookup(params.providerId, params.externalIds, installation) };
  });

  server.on("addons.getCategories", async (params) => {
    const installation = installationService.require();
    const categories = await service.getCategories(params.providerId, installation);
    return { categories };
  });

  server.on("addons.install", async (params) => {
    const installation = installationService.require();
    const { addon, operation } = await service.install({
      intent: "install",
      providerId: params.providerId,
      externalId: params.externalId,
      installation,
      channel: params.channel === undefined ? undefined : channelFromWire(params.channel),
    });
    return { addon: service.wire(addon), operation };
  });

  server.on("addons.setChannel", async (params) => {
    const { addon, operation } = await service.setChannel(params.addonId, channelFromWire(params.channel));
    return { addon: service.wire(addon), operation };
  });

  server.on("addons.reinstall", async (params) => {
    const { addon, operation } = await service.reinstall(params.addonId);
    return { addon: service.wire(addon), operation };
  });

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
    if ("addonId" in params) {
      return service.findOtherSources(params.addonId);
    }
    const installation = installationService.require();
    return service.findSources(installation, params.folderName);
  });

  server.on("addons.changeSource", async (params) => {
    const { addon, operation } = await service.changeSource(params.addonId, params.providerId, params.externalId);
    return { addon: service.wire(addon), operation };
  });

  server.on("addons.adopt", async (params) => {
    const installation = installationService.require();
    const { addon, operation } = await service.adopt(installation, params.folderName, params.providerId, params.externalId);
    return { addon: service.wire(addon), operation };
  });

  server.on("addons.setIgnored", async (params) => {
    const addon = service.setIgnored(params.addonId, params.ignored);
    return { addon: service.wire(addon) };
  });

  server.on("addons.update", async (params) => {
    const { addon, operation } = await service.updateAddon(params.addonId);
    return { addon: service.wire(addon), operation };
  });

  server.on("addons.updateAll", async (params) => {
    if (params.allInstallations) {
      // No automatic update in the check: everything is updated right after.
      await updateCheck.checkAll({ autoUpdate: false });
      return { operations: await service.updateAllInstallations() };
    }
    const installation = installationService.require();
    const operations = await service.updateAll(installation);
    return { operations };
  });

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
