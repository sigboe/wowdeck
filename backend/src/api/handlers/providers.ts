/** RPC handlers: Addon sources and the CurseForge key. */

import type { JsonlServer } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";
import { NotFoundError } from "../../wow/errors";

export function register(server: JsonlServer, { store, registry, companionCoordinator, curseForgeAuth, curseForgeProvider, tsmAuth, tsmData, installationService }: HandlerDeps): void {
  server.on("tradeskillmaster.cleanupPreview", async (params) => tsmData.cleanupPreview(installationService.require(params.installationId).id));
  server.on("tradeskillmaster.account", async () => tsmData.account());
  server.on("tradeskillmaster.unfollow", async (params) => tsmData.unfollow(params.realmId, params.auctionHouseType));
  server.on("tradeskillmaster.refresh", async (params) => tsmData.refresh(installationService.require(params.installationId).id));
  server.on("tradeskillmaster.wake", async () => tsmData.wake());
  server.on("tradeskillmaster.setFollow", async (params) => tsmData.setFollow(installationService.require(params.installationId).id, params.realmId, params.auctionHouseType, params.followed));
  server.on("tradeskillmaster.destination", async (params) => tsmData.destination(installationService.require(params.installationId).id));
  server.on("tradeskillmaster.status", async () => tsmAuth.status());
  server.on("tradeskillmaster.signIn", async () => tsmAuth.begin());
  server.on("tradeskillmaster.cancel", async () => tsmAuth.cancel());
  server.on("tradeskillmaster.signOut", async () => tsmAuth.signOut());
  server.on("providers.list", async () => ({
    providers: registry.providerInfos(),
  }));

  server.on("providers.setEnabled", async (params) => {
    // Off keeps the account (pause); Sign out forgets it.
    if (params.providerId === "TradeSkillMaster" && params.enabled && !tsmAuth.signedIn &&
        !(await tsmAuth.resume())) {
      throw new Error("Sign in to TradeSkillMaster first");
    }
    if (params.providerId === "TradeSkillMaster" && !params.enabled) tsmAuth.pause();
    const providers = registry.setEnabled(params.providerId, params.enabled);
    // Eligibility (AddonService.eligibleUpdatesFor) already reads
    // provider.enabled live, so this is a cheap regen — no network call
    // needed to react to a toggle that only changes local state.
    void companionCoordinator.regenerate();
    return { providers };
  });

  server.on("providers.testApiKey", async (params) => {
    const provider = registry.get(params.providerId);
    if (!provider) {
      throw new NotFoundError("provider", params.providerId);
    }
    const apiKey = params.apiKey ?? store.settings.curseApiKey ?? "";
    if (!apiKey.trim()) {
      return { ok: false, httpStatus: null, message: "no API key entered" };
    }
    return provider.testApiKey(apiKey);
  });

  server.on("curseforge.authStatus", async () => curseForgeAuth.snapshot());

  server.on("curseforge.recheckBundledKey", async () => {
    await curseForgeAuth.recheck((key) => curseForgeProvider.testApiKey(key));
    return curseForgeAuth.snapshot();
  });
}
