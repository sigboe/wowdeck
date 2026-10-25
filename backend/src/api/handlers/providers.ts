/** RPC handlers: Addon sources and the CurseForge key. */

import type { JsonlServer } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";
import { NotFoundError } from "../../wow/errors";

export function register(server: JsonlServer, { store, registry, companionCoordinator, curseForgeAuth, curseForgeProvider }: HandlerDeps): void {
  server.on("providers.list", async () => ({
    providers: registry.providerInfos(),
  }));

  server.on("providers.setEnabled", async (params) => {
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
