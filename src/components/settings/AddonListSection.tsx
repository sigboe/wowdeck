import { Field, PanelSection } from "@decky/ui";
import { FaChevronRight } from "react-icons/fa";
import type { Installation } from "../../types";
import { descriptionStyle } from "../../steamTheme";
import { openAddonPortabilityModal } from "../AddonPortabilityModal";
import { SettingsRow } from "./common";

interface Props {
  installations: Installation[];
  selectedId: string | null;
  onChanged: () => Promise<void>;
}

/** Export and import of the addon list (WowUp's format). */
export function AddonListSection({ installations, selectedId, onChanged }: Props) {
  const openPortability = (mode: "export" | "import") =>
    openAddonPortabilityModal({
      mode,
      installations,
      selectedInstallationId: selectedId,
      onInstalled: () => {
        void onChanged();
      },
    });

  return (
    <PanelSection title="Addon list">
      <SettingsRow id="export">
        <Field
          focusable={installations.length > 0}
          disabled={installations.length === 0}
          label="Export addon list"
          description={<span style={descriptionStyle}>Share it with WowUp or another device</span>}
          onClick={() => installations.length > 0 && openPortability("export")}
        >
          <FaChevronRight />
        </Field>
      </SettingsRow>
      <SettingsRow id="import">
        <Field
          focusable={installations.length > 0}
          disabled={installations.length === 0}
          label="Import addon list"
          description={<span style={descriptionStyle}>From another computer or WowUp</span>}
          onClick={() => installations.length > 0 && openPortability("import")}
        >
          <FaChevronRight />
        </Field>
      </SettingsRow>
    </PanelSection>
  );
}
