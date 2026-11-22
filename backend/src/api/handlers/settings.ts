/** RPC handlers: Options settings (rules in wow/storage/settings.ts). */

import type { HandlerTable } from "../../bridge/jsonl";
import type { InstallationService } from "../../wow/installation/InstallationService";
import type { StateStore } from "../../wow/storage/StateStore";
import { redactSettings, userSettingsPatch } from "../../wow/storage/settings";
import { validateBackupDir } from "../../wow/wtf/WtfPaths";

/** What the settings handlers use. */
export interface SettingsDeps {
  store: Pick<StateStore, "settings" | "saveSettings">;
  installationService: Pick<InstallationService, "list">;
}

export function settingsHandlers({ store, installationService }: SettingsDeps) {
  return {
    /**
     * Tokens are never echoed: every response is redacted (a set token reads
     * "<configured>"), which still tells the UI whether one is set.
     */
    "settings.get": async () => ({ settings: redactSettings(store.settings) }),

    "settings.set": async (params) => {
      // Only what Options may write, each value made valid (settings.ts).
      const patch = userSettingsPatch(params.settings);
      if (patch.wtfBackupDir) {
        patch.wtfBackupDir = await validateBackupDir(
          patch.wtfBackupDir,
          installationService.list().map((i) => i.location),
        );
      }
      // Answers once the settings' subscribers (engine.ts) have reacted.
      return { settings: redactSettings(await store.saveSettings(patch)) };
    },
  } satisfies Partial<HandlerTable>;
}
