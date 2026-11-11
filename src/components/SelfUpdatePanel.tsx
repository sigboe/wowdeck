import { useSyncExternalStore } from "react";
import { DialogButton, Field } from "@decky/ui";
import { registerFocusElement } from "../focusMemory";
import { updateReturnDirection } from "../updatePanelNavigation";
import { QAM_VIEW } from "../qamState";
import {
  isOffChannel,
  panelOffer,
  pluginUpdateDot,
  prChannelLine,
  releaseNotesAction,
} from "../pluginUpdate";
import { selfUpdateStore } from "../selfUpdate";
import { downloadView } from "../selfUpdateStore";
import { QamProgressBar } from "./QamProgressBar";
import { FocusRow } from "./FocusSlot";
import { openReleaseNotesModal } from "./ReleaseNotesModal";
import { UpdateDot } from "./UpdateDot";

/**
 * Options' update panel, floating under the nav bar while the engine offers
 * an installable WoWDeck release: the offer's headline plus the plugin's
 * only Update button. While it stages, Valve's progress bar takes the
 * button's place ("Downloading X of Y MB", then "Preparing…" for Decky's
 * handoff), and B on it cancels the download silently. When the offer has
 * release notes, Y on the button opens them in a modal (ReleaseNotesModal);
 * they are never shown inline, so the Options rows below scroll freely.
 * X is Check again: the button reads "Checking…", disabled, until it lands.
 * Same row context and focus memory as My Addons' installation switcher.
 *
 * On a PR channel with nothing newer (GLOSSARY: PR channel), the panel
 * reads "Up to date with PR #N", with Check again on X; a newer build of
 * the PR is the engine's offer like any other.
 */
export function SelfUpdatePanel() {
  const state = useSyncExternalStore(selfUpdateStore.subscribe, selfUpdateStore.get);
  const { info, staging, checking } = state;
  const download = downloadView(state);
  const line = prChannelLine(info);
  if (line) {
    return <PrChannelLine line={checking ? "Checking…" : line} />;
  }
  const offer = panelOffer(info);
  if (!offer) {
    return null;
  }
  if (download) {
    return <DownloadRow headline={offer.headline} download={download} />;
  }
  const releaseNotes = releaseNotesAction(offer);
  // No Check again off any channel (a test build): the answer can only
  // repeat the same leave-test offer; the channel modal (⋯ on the Updates
  // row) is the way.
  const test = isOffChannel(info);
  return (
    <div style={{ padding: "0 16px 8px" }}>
      <FocusRow view={QAM_VIEW.settings} id="selfUpdate">
        <div
          ref={(el) =>
            registerFocusElement(
              QAM_VIEW.settings,
              "selfUpdateAction",
              staging || checking ? null : el,
              true,
            )
          }
          style={{ display: "flex", alignItems: "center", gap: "12px" }}
        >
          <div style={{ flex: "1 1 0", minWidth: 0, overflowWrap: "normal", wordBreak: "normal" }}>
            {offer.headline}
          </div>
          <DialogButton
            style={{
              position: "relative",
              minWidth: 0,
              width: "auto",
              flexShrink: 0,
              whiteSpace: "nowrap",
              padding: "8px 16px",
            }}
            onGamepadDirection={updateReturnDirection}
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
            {checking ? "Checking…" : "Update"}
            <UpdateDot color={pluginUpdateDot(info)} />
          </DialogButton>
        </div>
      </FocusRow>
    </div>
  );
}

/**
 * The download in the button's place: Valve's progress bar with what it
 * is doing. B on it cancels the download; the engine answers "cancelled"
 * and the button comes back with no toast.
 */
function DownloadRow({
  headline,
  download,
}: {
  headline: string;
  download: NonNullable<ReturnType<typeof downloadView>>;
}) {
  return (
    <div style={{ padding: "0 16px 8px" }}>
      <FocusRow view={QAM_VIEW.settings} id="selfUpdate">
        <Field
          label={headline}
          bottomSeparator="none"
          childrenLayout="below"
          focusable
          onCancelButton={() => void selfUpdateStore.cancelDownload()}
          onCancelActionDescription="Cancel download"
        >
          <QamProgressBar
            indeterminate={download.percent === null}
            nProgress={download.percent ?? undefined}
            sOperationText={download.text}
          />
        </Field>
      </FocusRow>
    </div>
  );
}

/** The panel on an up-to-date PR channel: its line, with Check again on X. */
function PrChannelLine({ line }: { line: string }) {
  return (
    <div style={{ padding: "0 16px 8px" }}>
      <FocusRow view={QAM_VIEW.settings} id="selfUpdate">
        <Field
          label={line}
          bottomSeparator="none"
          focusable
          onSecondaryActionDescription="Check again"
          onSecondaryButton={() => void selfUpdateStore.checkAgain()}
        />
      </FocusRow>
    </div>
  );
}
