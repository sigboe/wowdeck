import { useSyncExternalStore } from "react";
import { DialogButton, Field } from "@decky/ui";
import { QAM_VIEW } from "../qamState";
import { panelOffer, pluginUpdateDot, releaseNotesAction } from "../pluginUpdate";
import { selfUpdateStore } from "../selfUpdate";
import { FocusRow } from "./FocusSlot";
import { openReleaseNotesModal } from "./ReleaseNotesModal";
import { UpdateDot } from "./UpdateDot";

/**
 * Options' update panel, floating under the nav bar while the engine offers
 * an installable WoWDeck release: the offer's headline plus the plugin's
 * only Update button ("Preparing…" while staging). When the offer has
 * release notes, Y on the button opens them in a modal (ReleaseNotesModal);
 * they are never shown inline, so the Options rows below scroll freely.
 * Same row context and focus memory as My Addons' installation switcher.
 */
export function SelfUpdatePanel() {
  const { info, staging } = useSyncExternalStore(selfUpdateStore.subscribe, selfUpdateStore.get);
  const offer = panelOffer(info);
  if (!offer) {
    return null;
  }
  const releaseNotes = releaseNotesAction(offer);
  return (
    <div style={{ padding: "0 16px 8px" }}>
      <FocusRow view={QAM_VIEW.settings} id="selfUpdate">
        <Field label={offer.headline} bottomSeparator="none">
          <DialogButton
            style={{ position: "relative", minWidth: 0, width: "auto", padding: "8px 16px" }}
            disabled={staging}
            onClick={() => void selfUpdateStore.runUpdate()}
            onOptionsActionDescription={releaseNotes?.label}
            onOptionsButton={
              releaseNotes
                ? () => openReleaseNotesModal(releaseNotes, offer.buttonLabel)
                : undefined
            }
          >
            {staging ? "Preparing…" : offer.buttonLabel}
            <UpdateDot color={pluginUpdateDot(info)} />
          </DialogButton>
        </Field>
      </FocusRow>
    </div>
  );
}
