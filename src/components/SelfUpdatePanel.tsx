import { useSyncExternalStore } from "react";
import { DialogButton, Field } from "@decky/ui";
import { QAM_VIEW } from "../qamState";
import { isTestBuild, panelOffer, pluginUpdateDot, releaseNotesAction } from "../pluginUpdate";
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
 * X is Check again: the button reads "Checking…", disabled, until it lands.
 * Same row context and focus memory as My Addons' installation switcher.
 */
export function SelfUpdatePanel() {
  const { info, staging, checking } = useSyncExternalStore(
    selfUpdateStore.subscribe,
    selfUpdateStore.get,
  );
  const offer = panelOffer(info);
  if (!offer) {
    return null;
  }
  const releaseNotes = releaseNotesAction(offer);
  // No Check again on a test build: the answer can only repeat the same
  // leave-test offer; the channel modal (⋯ on the Updates row) is the way.
  const test = isTestBuild(info);
  return (
    <div style={{ padding: "0 16px 8px" }}>
      <FocusRow view={QAM_VIEW.settings} id="selfUpdate">
        <Field label={offer.headline} bottomSeparator="none">
          <DialogButton
            style={{ position: "relative", minWidth: 0, width: "auto", padding: "8px 16px" }}
            disabled={staging || checking}
            onClick={() => void selfUpdateStore.runUpdate()}
            {...(!test && {
              onSecondaryActionDescription: "Check again",
              onSecondaryButton: () => void selfUpdateStore.checkAgain(),
            })}
            onOptionsActionDescription={releaseNotes?.label}
            onOptionsButton={
              releaseNotes
                ? () => openReleaseNotesModal(releaseNotes, offer.buttonLabel)
                : undefined
            }
          >
            {checking ? "Checking…" : staging ? "Preparing…" : offer.buttonLabel}
            <UpdateDot color={pluginUpdateDot(info)} />
          </DialogButton>
        </Field>
      </FocusRow>
    </div>
  );
}
