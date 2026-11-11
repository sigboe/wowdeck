import { useSyncExternalStore } from "react";
import { DialogButton, Field } from "@decky/ui";
import * as api from "../services/backend";
import { QAM_VIEW } from "../qamState";
import {
  isTestBuild,
  panelOffer,
  pluginUpdateDot,
  prBuildOffer,
  releaseNotesAction,
  type PrBuildOffer,
} from "../pluginUpdate";
import { selfUpdateStore } from "../selfUpdate";
import { FocusRow } from "./FocusSlot";
import { openPrBuildsModal } from "./PrBuildsModal";
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
 *
 * On a PR build whose PR has moved on (prBuildOffer), the panel offers
 * that instead: a newer build of the PR (confirmed in the PR builds
 * modal), the beta with the merged PR, or word that one is still building,
 * with no button.
 */
export function SelfUpdatePanel() {
  const { info, prState, staging, checking } = useSyncExternalStore(
    selfUpdateStore.subscribe,
    selfUpdateStore.get,
  );
  const pr = prBuildOffer(info, prState);
  if (pr) {
    return <PrBuildPanel offer={pr} busy={staging || checking} staging={staging} />;
  }
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

/** The panel on a PR build whose PR moved on. No Check again, as on any test build. */
function PrBuildPanel({
  offer,
  busy,
  staging,
}: {
  offer: PrBuildOffer;
  busy: boolean;
  staging: boolean;
}) {
  const press = () => {
    if (offer.kind === "newerBuild") {
      openPrBuildsModal(api.rpc, offer.build);
    } else if (offer.kind === "mergedBeta") {
      void selfUpdateStore.switchToBeta();
    }
  };
  return (
    <div style={{ padding: "0 16px 8px" }}>
      <FocusRow view={QAM_VIEW.settings} id="selfUpdate">
        <Field label={offer.headline} bottomSeparator="none" focusable={offer.buttonLabel === null}>
          {offer.buttonLabel !== null && (
            <DialogButton
              style={{ position: "relative", minWidth: 0, width: "auto", padding: "8px 16px" }}
              disabled={busy}
              onClick={press}
            >
              {staging ? "Preparing…" : offer.buttonLabel}
              <UpdateDot color="update" />
            </DialogButton>
          )}
        </Field>
      </FocusRow>
    </div>
  );
}
