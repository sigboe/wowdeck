import { useSyncExternalStore } from "react";
import { DialogButton, Field } from "@decky/ui";
import { QAM_VIEW } from "../qamState";
import { pluginUpdateButton, pluginUpdateDot, pluginUpdatePanel } from "../pluginUpdate";
import { selfUpdateStore } from "../selfUpdate";
import { FocusRow } from "./FocusSlot";
import { UpdateDot } from "./UpdateDot";

/**
 * Options' update panel, floating under the nav bar while a WoWDeck release
 * is available: one line plus the plugin's only Update button. Same row
 * context and focus memory as My Addons' installation switcher.
 */
export function SelfUpdatePanel() {
  const { info, staging } = useSyncExternalStore(selfUpdateStore.subscribe, selfUpdateStore.get);
  const panel = pluginUpdatePanel(info);
  if (!panel) {
    return null;
  }
  const button = pluginUpdateButton(staging, info);
  return (
    <div style={{ padding: "0 16px 8px" }}>
      <FocusRow view={QAM_VIEW.settings} id="selfUpdate">
        <Field label={panel.text} bottomSeparator="none">
          <DialogButton
            style={{ position: "relative", minWidth: 0, width: "auto", padding: "8px 16px" }}
            disabled={button.disabled}
            onClick={() => void selfUpdateStore.runUpdate()}
          >
            {button.label}
            <UpdateDot color={pluginUpdateDot(info)} />
          </DialogButton>
        </Field>
      </FocusRow>
    </div>
  );
}
