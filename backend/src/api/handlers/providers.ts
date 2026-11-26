/** RPC handlers: Addon sources and the CurseForge key. */

import type { HandlerTable } from "../../bridge/jsonl";
import type { InstallationService } from "../../wow/installation/InstallationService";
import type { CurseForgeAuthService } from "../../wow/providers/curseforge/CurseForgeKeyAuth";
import type { CurseForgeProvider } from "../../wow/providers/curseforge/CurseForgeProvider";
import type { ProviderRegistry } from "../../wow/providers/provider-registry";
import type { StateStore } from "../../wow/storage/StateStore";
import type { TradeSkillMasterAuth } from "../../wow/tsm/TradeSkillMasterAuth";
import type { TradeSkillMasterData } from "../../wow/tsm/TradeSkillMasterData";
import type { TradeSkillMasterLedgerReader } from "../../wow/tsm/Ledger";
import { NotFoundError, ValidationError } from "../../wow/errors";
import { MAX_ICON_SIZE, MAX_ICONS, type GameTextures } from "../../wow/textures/GameTextures";
import { exportStartFolder } from "../../wow/tsm/LedgerExport";

/** What the addon source handlers use. */
export interface ProvidersDeps {
  store: Pick<StateStore, "settings" | "updateSettings">;
  registry: Pick<ProviderRegistry, "get" | "providerInfos" | "setEnabled">;
  curseForgeAuth: Pick<CurseForgeAuthService, "recheck" | "snapshot">;
  curseForgeProvider: Pick<CurseForgeProvider, "testApiKey">;
  tsmAuth: Pick<TradeSkillMasterAuth, "begin" | "cancel" | "signOut" | "status">;
  tsmData: Pick<TradeSkillMasterData, "account" | "cleanupPreview" | "destination" | "refresh" | "setFollow" | "unfollow" | "wake">;
  /** The Ledger: the addon's own records, read from WoW's saved files. */
  tsmLedger: Pick<TradeSkillMasterLedgerReader, "itemTextures" | "ledger" | "ledgerExport" | "ledgerItems">;
  /** Icons read from the game's files. */
  gameTextures: Pick<GameTextures, "icons">;
  installationService: Pick<InstallationService, "require">;
  /** Where Export's folder picker looks for Documents. */
  homeDir: string;
}

export function providersHandlers({ store, registry, curseForgeAuth, curseForgeProvider, tsmAuth, tsmData, tsmLedger, gameTextures, installationService, homeDir }: ProvidersDeps) {
  return {
    "tradeskillmaster.cleanupPreview": async (params) => tsmData.cleanupPreview(installationService.require(params.installationId).id),
    "tradeskillmaster.account": async () => tsmData.account(),
    "tradeskillmaster.unfollow": async (params) => tsmData.unfollow(params.realmId, params.auctionHouseType),
    "tradeskillmaster.refresh": async (params) => tsmData.refresh(installationService.require(params.installationId).id),
    "tradeskillmaster.wake": async () => tsmData.wake(),
    "tradeskillmaster.setFollow": async (params) => tsmData.setFollow(installationService.require(params.installationId).id, params.realmId, params.auctionHouseType, params.followed),
    "tradeskillmaster.destination": async (params) => tsmData.destination(installationService.require(params.installationId).id),
    "tradeskillmaster.ledger": async (params) => tsmLedger.ledger(installationService.require(params.installationId), params.account, {
      realm: params.realm,
      character: params.character,
      period: params.period,
      plotWidth: params.plotWidth,
    }),
    "tradeskillmaster.ledgerItems": async (params) => tsmLedger.ledgerItems(installationService.require(params.installationId), params),
    "tradeskillmaster.itemIcons": async ({ installationId, account, textures, size }) => {
      if (!Array.isArray(textures) || textures.length > MAX_ICONS || !textures.every((t) => Number.isSafeInteger(t) && t > 0)) {
        throw new ValidationError(`textures must be at most ${MAX_ICONS} positive integers`);
      }
      if (!Number.isInteger(size) || size < 1 || size > MAX_ICON_SIZE) {
        throw new ValidationError(`size must be 1 to ${MAX_ICON_SIZE}`);
      }
      const installation = installationService.require(installationId);
      const icons = await gameTextures.icons(installation, textures, size, () => tsmLedger.itemTextures(installation, account));
      return { icons };
    },
    "tradeskillmaster.ledgerExport": async ({ installationId, ...params }) => {
      const path = await tsmLedger.ledgerExport(installationService.require(installationId), params);
      store.updateSettings({ tsmLedgerExportFolder: params.folder });
      return { path };
    },
    "tradeskillmaster.ledgerExportFolder": async () => ({
      folder: exportStartFolder(store.settings.tsmLedgerExportFolder, homeDir),
    }),
    "tradeskillmaster.status": async () => tsmAuth.status(),
    "tradeskillmaster.signIn": async () => tsmAuth.begin(),
    "tradeskillmaster.cancel": async () => tsmAuth.cancel(),
    "tradeskillmaster.signOut": async () => tsmAuth.signOut(),
    "providers.list": async () => ({
      providers: registry.providerInfos(),
    }),

    "providers.setEnabled": async (params) => ({ providers: await registry.setEnabled(params.providerId, params.enabled) }),

    "providers.testApiKey": async (params) => {
      const provider = registry.get(params.providerId);
      if (!provider) {
        throw new NotFoundError("provider", params.providerId);
      }
      const apiKey = params.apiKey ?? store.settings.curseApiKey ?? "";
      if (!apiKey.trim()) {
        return { ok: false, httpStatus: null, message: "no API key entered" };
      }
      return provider.testApiKey(apiKey);
    },

    "curseforge.authStatus": async () => curseForgeAuth.snapshot(),

    "curseforge.recheckBundledKey": async () => {
      await curseForgeAuth.recheck((key) => curseForgeProvider.testApiKey(key));
      return curseForgeAuth.snapshot();
    },
  } satisfies Partial<HandlerTable>;
}
