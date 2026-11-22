import { DialogButton, PanelSection, PanelSectionRow, Spinner } from "@decky/ui";
import { descriptionStyle } from "../steamTheme";
import { QAM_VIEW } from "../qamState";
import type { AddonSession } from "../addonSession";
import type { AddWowFolderDeps } from "../addWowFolder";
import { focusTarget, useRestoreFocus } from "./FocusSlot";
import { runAddWowFolder } from "./addWowFolderUi";

interface Props {
  installationCount: number;
  detecting: boolean;
  result: string | null;
  onDetect: () => void;
  /** Adds the picked folder's installations and reads the lists again. */
  session: Pick<AddonSession, "addInstallation">;
  restoreRows?: boolean;
  /** Swaps Add WoW folder's collaborators (tests). */
  addFolderDeps?: Partial<AddWowFolderDeps>;
}

/** Setup where a player first lands: detection, or Add WoW folder (the same flow as Options). */
export function FindWowWidget({
  installationCount,
  detecting,
  result,
  onDetect,
  session,
  restoreRows = true,
  addFolderDeps,
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
          {detecting ? (
            <>
              <Spinner style={{ width: "1em", display: "inline-block", marginRight: "8px" }} />
              Finding WoW…
            </>
          ) : (
            "Find WoW"
          )}
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
        <DialogButton
          onClick={() =>
            void runAddWowFolder(QAM_VIEW.installed, "addWowFolder", [], session, addFolderDeps)
          }
          {...focusTarget(QAM_VIEW.installed, "addWowFolder")}
        >
          Add WoW folder
        </DialogButton>
      </PanelSectionRow>
    </PanelSection>
  );
}
