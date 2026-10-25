/** RPC handlers: Options settings (rules in wow/storage/settings.ts). */

import type { JsonlServer } from "../../bridge/jsonl";
import type { HandlerDeps } from "./deps";
import { redactSettings, userSettingsPatch } from "../../wow/storage/settings";
import { validateBackupDir } from "../../wow/wtf/WtfPaths";

export function register(server: JsonlServer, { store, registry, installationService, curseForgeAuth, curseForgeProvider }: HandlerDeps): void {
  /**
   * Tokens are never echoed: every response is redacted (a set token reads
   * "<configured>"), which still tells the UI whether one is set.
   */
  server.on("settings.get", async () => ({ settings: redactSettings(store.settings) }));

  server.on("settings.set", async (params) => {
    const before = store.settings;
    // Only what Options may write, each value made valid (settings.ts).
    const patch = userSettingsPatch(params.settings);
    if (patch.wtfBackupDir) {
      patch.wtfBackupDir = await validateBackupDir(
        patch.wtfBackupDir,
        installationService.list().map((i) => i.location),
      );
    }
    const settings = store.updateSettings(patch);
    // a newly configured (or removed) API key changes provider defaults
    if (patch.curseApiKey !== undefined && patch.curseApiKey !== before.curseApiKey) {
      registry.refreshDefaults();
      // Re-validate server-side and record the authoritative verdict,
      // independent of whatever Options' own pre-save providers.testApiKey
      // check already showed the user — this is the one place that's
      // guaranteed to run right after the new value is actually persisted
      // (see CurseForgeAuthService.setUserCheckResult on why that matters).
      if (settings.curseApiKey) {
        await curseForgeAuth.recheck((key) => curseForgeProvider.testApiKey(key), settings.curseApiKey);
      }
    }
    return { settings: redactSettings(settings) };
  });
}
