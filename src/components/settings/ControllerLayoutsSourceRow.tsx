import { useSyncExternalStore } from "react";
import { ToggleField } from "@decky/ui";

import { settingsStore } from "../../settings";
import { SettingsRow } from "./common";

/**
 * The Controller layouts source in Options › Sources: a plain switch, apart
 * from the addon sources (no provider, no addon installs). What Off stops:
 * `controllerLayoutsEnabled` in the contract.
 */
export function ControllerLayoutsSourceRow() {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  return (
    <SettingsRow id="controllerLayouts">
      <ToggleField
        checked={settings.controllerLayoutsEnabled}
        label="Controller layouts"
        description="Steam controller layouts picked for WoW"
        onChange={(checked) => void settingsStore.save({ controllerLayoutsEnabled: checked })}
      />
    </SettingsRow>
  );
}
