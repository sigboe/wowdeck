import { useSyncExternalStore } from "react";
import { Field, PanelSection, PanelSectionRow, ToggleField } from "@decky/ui";
import type { Diagnostics } from "../../types";
import { descriptionStyle } from "../../steamTheme";
import { formatList } from "../../search";
import { settingsStore } from "../../settings";
import { SettingsRow } from "./common";

/** The update toast, and whether WoW shows updates in game (the companion addon). */
export function NotificationsSection({ diagnostics }: { diagnostics: Diagnostics | null }) {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  // A quiet status line, not an alert — the companion-data bridge
  // always runs (no setting), so this is shown unconditionally whenever
  // there's something useful to explain (at least one known
  // installation missing the real companion addon).
  const missingCompanion =
    diagnostics?.installations.filter((i) => !i.companionAddonDetected) ?? [];

  return (
    <PanelSection title="Notifications">
      <SettingsRow id="updateToast">
        <ToggleField
          checked={settings.updateToastEnabled}
          label="Update notifications"
          description="At most once a day, when the Deck starts or wakes up"
          onChange={(checked) => void settingsStore.save({ updateToastEnabled: checked })}
        />
      </SettingsRow>
      {/* The companion-data bridge has no setting; it always runs. A status row
          with its explanation as the description, not trailing help text (S22). */}
      <PanelSectionRow>
        <Field
          label="Updates inside WoW"
          description={
            <span style={descriptionStyle}>
              Shown in game when the WowUp Companion addon is installed.
              {missingCompanion.length > 0 &&
                ` Not installed in ${formatList(missingCompanion.map((i) => i.clientLabel))}.`}
            </span>
          }
        />
      </PanelSectionRow>
    </PanelSection>
  );
}
