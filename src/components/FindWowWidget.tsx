import { DialogButton, PanelSection, PanelSectionRow } from "@decky/ui";
import { descriptionStyle } from "../steamTheme";
import { QAM_VIEW } from "../qamState";
import { focusTarget, useRestoreFocus } from "./FocusSlot";

interface Props {
  installationCount: number;
  detecting: boolean;
  result: string | null;
  onDetect: () => void;
  onOpenOptions: () => void;
  restoreRows?: boolean;
}

/** Setup where a player first lands, using the existing detection and settings. */
export function FindWowWidget({
  installationCount,
  detecting,
  result,
  onDetect,
  onOpenOptions,
  restoreRows = true,
}: Props) {
  useRestoreFocus(QAM_VIEW.installed, restoreRows && installationCount === 0);
  if (installationCount > 0) {
    return null;
  }
  return (
    <PanelSection title="Find WoW">
      <PanelSectionRow>
        <div style={descriptionStyle}>
          Find your WoW installation to start managing addons. Looks in Steam, Lutris and other game
          folders.
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <DialogButton
          disabled={detecting}
          onClick={onDetect}
          {...focusTarget(QAM_VIEW.installed, "findWow")}
        >
          {detecting ? "Finding WoW…" : "Find WoW"}
        </DialogButton>
      </PanelSectionRow>
      {result && (
        <PanelSectionRow>
          <div role="status" style={descriptionStyle}>
            {result}
          </div>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <div style={descriptionStyle}>
          If WoW isn&apos;t found, add its folder in Options. Under Steam library, link WoW or
          Battle.net to show addon updates on its game page and tile.
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <DialogButton
          onClick={onOpenOptions}
          {...focusTarget(QAM_VIEW.installed, "findWowOptions")}
        >
          Open Options
        </DialogButton>
      </PanelSectionRow>
    </PanelSection>
  );
}
