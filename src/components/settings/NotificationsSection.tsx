import { useSyncExternalStore } from "react";
import { Field, PanelSection, ToggleField } from "@decky/ui";
import { FaChevronRight } from "react-icons/fa";
import type { Diagnostics, Installation } from "../../types";
import * as api from "../../services/backend";
import { descriptionStyle } from "../../steamTheme";
import { formatList } from "../../search";
import { settingsStore } from "../../settings";
import { sourcesStore } from "../../sourcesStore";
import { loadDiagnostics } from "../../diagnosticsStore";
import { COMPANION_PROVIDER_ID, companionStatus } from "../../companionInstall";
import { offerCompanionInstall } from "../companionInstallModal";
import { rememberFocus } from "../../focusMemory";
import { SettingsRow, VIEW } from "./common";

/** The update toast, and whether WoW shows updates in game (the companion addon). */
export function NotificationsSection({
  diagnostics,
  installation,
  onChanged,
}: {
  diagnostics: Diagnostics | null;
  /** The active installation: the only one offered a WowUp Companion install. */
  installation: Installation | null;
  /** Reload installations + addons (My Addons lists the companion once installed). */
  onChanged: () => Promise<void>;
}) {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  // A quiet status line, not an alert: the companion-data bridge always runs
  // (no setting). The active installation's own state comes first; the other
  // installations missing the real companion addon are only named (no bulk or
  // other-installation install, spec #183).
  const status = companionStatus(diagnostics, installation?.id ?? null);
  const name = installation?.displayName ?? "";
  const statusText =
    status.kind === "missing"
      ? ` Not installed in ${formatList([name, ...status.missingElsewhere])}.`
      : status.kind === "installed"
        ? ` Installed in ${name}.${
            status.missingElsewhere.length > 0
              ? ` Not installed in ${formatList(status.missingElsewhere)}.`
              : ""
          }`
        : status.missingElsewhere.length > 0
          ? ` Not installed in ${formatList(status.missingElsewhere)}.`
          : "";
  const offer = status.kind === "missing" && installation ? installation : null;

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
          with its explanation as the description (S22), focusable so D-pad
          scrolling doesn't skip it; `>` only while it offers the install. */}
      <SettingsRow id="updatesInsideWow">
        <Field
          verticalAlignment="center"
          childrenContainerWidth="min"
          focusable
          label="Updates inside WoW"
          description={
            <span style={descriptionStyle}>
              Shown in game when the WowUp Companion addon is installed.{statusText}
            </span>
          }
          onClick={() => {
            rememberFocus(VIEW, "updatesInsideWow");
            if (offer) {
              offerCompanionInstall(offer, {
                rpc: api.rpc,
                hubEnabled: () =>
                  sourcesStore.get().providers?.find((p) => p.id === COMPANION_PROVIDER_ID)
                    ?.enabled ?? false,
                reloadDiagnostics: () => loadDiagnostics(api.rpc),
                reloadAddons: onChanged,
              });
            }
          }}
        >
          {offer && <FaChevronRight />}
        </Field>
      </SettingsRow>
    </PanelSection>
  );
}
