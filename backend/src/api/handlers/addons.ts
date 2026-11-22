/** RPC handlers: Addons: list, check, search, browse, install, update, rollback, import/export. */

import type { HandlerTable } from "../../bridge/jsonl";
import type { AddonService } from "../../wow/addons/AddonService";
import type { Catalogue } from "../../wow/catalogue/Catalogue";
import type { InstallationService } from "../../wow/installation/InstallationService";
import type { AddonUpdates } from "../../wow/addons/AddonUpdates";
import type { TradeSkillMasterData } from "../../wow/tsm/TradeSkillMasterData";
import { settle } from "../../bridge/jsonl";
import { channelFromWire } from "../../wow/addons/releaseChannel";
import { NotFoundError } from "../../wow/errors";
import { runningFileManager, showItems } from "../../desktop/FileManager";
import { removeTradeSkillMasterAddons } from "../../wow/tsm/TradeSkillMasterFolders";

/** What the addon handlers use. */
export interface AddonsDeps {
  service: Pick<
    AddonService,
    | "addonList"
    | "addonFolders"
    | "adopt"
    | "changeSource"
    | "clearRollback"
    | "importAddonList"
    | "inspectArchive"
    | "install"
    | "lookup"
    | "portability"
    | "reinstall"
    | "removeAddon"
    | "removeEach"
    | "removeUnmanagedFolder"
    | "rollback"
    | "rollbackStatus"
    | "setAutoUpdatePaused"
    | "setChannel"
    | "setIgnored"
    | "sourceRequestForAddon"
    | "sourceRequestForFolder"
    | "updateAddon"
  >;
  catalogue: Pick<Catalogue, "discover" | "findSources" | "getCategories" | "getChangelog" | "getDescription" | "resolveUrlImport" | "search">;
  installationService: Pick<InstallationService, "require">;
  addonUpdates: Pick<AddonUpdates, "refresh" | "updateSummary" | "updateAll" | "updateAllInstallations">;
  tsmData: Pick<TradeSkillMasterData, "cleanupFollows">;
}

export function addonsHandlers({ service, catalogue, installationService, addonUpdates, tsmData }: AddonsDeps) {
  return {
    "addons.list": async (params) => {
      const installation = installationService.require(params.installationId);
      return service.addonList(installation);
    },

    "addons.refresh": async (params) => addonUpdates.refresh(installationService.require(params.installationId)),

    "addons.folders": async (params) => {
      const installation = installationService.require(params.installationId);
      const [{ addonsPath, folders }, fileManager] = await Promise.all([
        service.addonFolders(installation, params.addonId),
        runningFileManager(),
      ]);
      return { addonsPath, folders, fileManager };
    },

    "addons.showFolders": async (params) => {
      const installation = installationService.require(params.installationId);
      const { folders } = await service.addonFolders(installation, params.addonId);
      const onDisk = folders.filter((f) => f.present).map((f) => f.path);
      if (onDisk.length === 0) {
        throw new NotFoundError("addon folders for", params.addonId);
      }
      return showItems(onDisk);
    },

    "addons.search": async (params) => {
      const installation = installationService.require(params.installationId);
      return catalogue.search(params.query, installation, params.providerId);
    },

    // Never-throws (contracts.ts Settled): every failure, an unknown
    // installation included, is part of the answer, so require() runs inside.
    "addons.resolveUrlImport": async (params) =>
      settle(() => catalogue.resolveUrlImport(params.url, installationService.require(params.installationId))),

    "addons.inspectArchive": async (params) =>
      settle(() => service.inspectArchive(params.path, installationService.require(params.installationId))),

    "discover.latest": async (params) => {
      const installation = installationService.require(params.installationId);
      return catalogue.discover("latest", params.providerId, installation, params.index, params.pageSize);
    },

    "discover.popular": async (params) => {
      const installation = installationService.require(params.installationId);
      return catalogue.discover(
        "popular",
        params.providerId,
        installation,
        params.index,
        params.pageSize,
        params.categoryId,
      );
    },

    "addons.getDescription": async (params) => {
      const description = await catalogue.getDescription(params.providerId, params.externalId);
      return { description };
    },

    "addons.getChangelog": async (params) => {
      const installation = installationService.require(params.installationId);
      const changelog = await catalogue.getChangelog(params.providerId, params.externalId, installation);
      return { changelog };
    },

    "addons.updateSummary": async (params) => ({ installations: await addonUpdates.updateSummary(params.refresh === true, params.manual === true) }),

    "addons.rollback": async (params) => service.rollback(params.addonId),

    "addons.setAutoUpdatePaused": async (params) => ({
      addon: await service.setAutoUpdatePaused(params.addonId, params.paused === true),
    }),

    "rollback.status": async () => service.rollbackStatus(),

    "rollback.clear": async () => service.clearRollback(),

    "addons.lookup": async (params) => {
      const installation = installationService.require(params.installationId);
      return { addons: await service.lookup(params.providerId, params.externalIds, installation) };
    },

    "addons.getCategories": async (params) => {
      const installation = installationService.require(params.installationId);
      const categories = await catalogue.getCategories(params.providerId, installation);
      return { categories };
    },

    "addons.install": async (params) =>
      service.install({
        intent: "install",
        providerId: params.providerId,
        externalId: params.externalId,
        installation: installationService.require(params.installationId),
        channel: params.channel === undefined ? undefined : channelFromWire(params.channel),
      }),

    "addons.setChannel": async (params) => service.setChannel(params.addonId, channelFromWire(params.channel)),

    "addons.reinstall": async (params) => service.reinstall(params.addonId),

    "tradeskillmaster.removeAddons": async (params) => {
      const installation = installationService.require(params.installationId);
      const cleanup = params.cleanupFollows ? await tsmData.cleanupFollows(installation.id, params.cleanupPreview) : undefined;
      return { operations: await removeTradeSkillMasterAddons(service, installation), cleanup };
    },

    "addons.remove": async (params) => {
      const operation = await service.removeAddon(params.addonId, { removeLibraries: params.removeLibraries });
      return { addonId: params.addonId, operation };
    },

    "addons.removeUnmanaged": async (params) => {
      const installation = installationService.require(params.installationId);
      const operation = await service.removeUnmanagedFolder(installation, params.folderName);
      return { operation };
    },

    "addons.findSources": async (params) => {
      const request =
        "addonId" in params
          ? await service.sourceRequestForAddon(params.addonId)
          : await service.sourceRequestForFolder(installationService.require(params.installationId), params.folderName);
      return catalogue.findSources(request);
    },

    "addons.changeSource": async (params) =>
      service.changeSource(params.addonId, params.providerId, params.externalId),

    "addons.adopt": async (params) =>
      service.adopt(installationService.require(params.installationId), params.folderName, params.providerId, params.externalId),

    "addons.setIgnored": async (params) => ({ addon: await service.setIgnored(params.addonId, params.ignored) }),

    "addons.update": async (params) => service.updateAddon(params.addonId),

    "addons.updateAll": async (params) => ({
      operations: "allInstallations" in params
        ? await addonUpdates.updateAllInstallations()
        : await addonUpdates.updateAll(installationService.require(params.installationId)),
    }),

    "addons.export": async (params) => {
      const installation = installationService.require(params.installationId);
      return service.portability.export(installation);
    },

    "addons.previewImport": async (params) => {
      const installation = installationService.require(params.installationId);
      return service.portability.preview(params.importString, installation);
    },

    "addons.importAddonList": async (params) => {
      const installation = installationService.require(params.installationId);
      // Each installed addon already fires the normal addonsChanged/
      // operationResult events through install() itself (same companion-data
      // regen and My Addons refresh every other install path gets).
      return service.importAddonList(params.importString, installation);
    },
  } satisfies Partial<HandlerTable>;
}
