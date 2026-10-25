import { useEffect, useRef } from "react";
import {
  DialogBody,
  DialogBodyText,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  ModalRoot,
  Spinner,
  showModal,
} from "@decky/ui";
import type { Addon, SearchResult } from "../types";
import * as api from "../services/backend";
import { useLazyResource } from "../useLazyResource";
import { searchOutcome } from "../search";
import { STEAM } from "../steamTheme";
import { providerLabel } from "../addonRow";
import { wowupModalStyleCss } from "../sharedStyles";
import { ScrollBuffer } from "./ScrollBuffer";
import { AddonResultRow } from "./AddonResultRow";
import { openAddonDetailsModal, resultDetails } from "./AddonDetailsModal";

/** What X does on a source, in its row and in its Details. */
const USE_LABEL = "Use this source";

interface Props {
  addon: Addon;
  onPick: (source: SearchResult) => void;
  closeModal?: () => void;
}

/** The dialog's title: an unmanaged folder finds a source, a managed addon changes it (WF-12). */
function sourceTitle(addon: Addon): string {
  return addon.providerId ? "Change source" : "Find online source";
}

/**
 * Find online source (WF-23): the sources whose release installs this
 * unmanaged folder; Change source (WF-12): the other sources of a managed
 * addon, whose release installs its main folder. Best first (the engine
 * ranks them), as Get Addons rows:
 * A opens Details to judge the match, X uses the source (from Details too),
 * which closes the dialog and installs it over the folder; B cancels. Focus
 * moves to the best one when they arrive (it starts on Cancel, the only
 * control until then). Built from Steam's dialog components like the Restore
 * dialog.
 */
function FindSourceModal({ addon, onPick, closeModal }: Props) {
  const { value, loading, error } = useLazyResource(() =>
    api.rpc(
      "addons.findSources",
      addon.providerId ? { addonId: addon.id } : { folderName: addon.folderName },
    ),
  );
  const outcome = value && searchOutcome(addon.name, value.results.length, value.providerErrors);
  const firstRow = useRef<HTMLDivElement | null>(null);
  useEffect(() => firstRow.current?.focus(), [value]);

  const use = (source: SearchResult) => {
    closeModal?.();
    onPick(source);
  };

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal} bAllowFullSize>
      <DialogHeader>{sourceTitle(addon)}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          {addon.providerId ? (
            <DialogBodyText>
              {addon.name} updates from {providerLabel(addon.providerId)} now.
              {value && value.results.length > 0 && (
                <>
                  {" "}
                  These providers also have it: their release installs its “{addon.folderName}”
                  folder. The one you use replaces its files and updates it from then on. Addon
                  settings are not touched.
                </>
              )}
            </DialogBodyText>
          ) : (
            <DialogBodyText>
              Addons that install the “{addon.folderName}” folder. The one you use replaces this
              folder and any others it includes, and keeps them up to date. Your files are kept:
              Roll back returns to them. Addon settings are not touched.
            </DialogBodyText>
          )}
          {(loading || (!value && !error)) && <Spinner style={{ width: "2em" }} />}
          {error && <DialogBodyText style={{ color: STEAM.danger }}>{error}</DialogBodyText>}
          {outcome?.kind === "error" && (
            <DialogBodyText style={{ color: STEAM.danger }}>{outcome.text}</DialogBodyText>
          )}
          {outcome?.kind === "empty" && (
            <DialogBodyText>
              {/* A source turned off in Options is never asked. */}
              {addon.providerId
                ? "No other provider has it. Sources turned off in Options aren't searched."
                : "No online source found."}
            </DialogBodyText>
          )}
          {value && value.results.length > 0 && (
            <DialogControlsSection>
              {value.results.map((source, i) => (
                <AddonResultRow
                  key={`${source.providerId}:${source.externalId}`}
                  memory={
                    i === 0
                      ? {
                          ref: (el) => {
                            firstRow.current = el;
                          },
                        }
                      : undefined
                  }
                  result={source}
                  installing={false}
                  tags={[]}
                  installLabel={USE_LABEL}
                  onInstall={() => use(source)}
                  onDetails={() =>
                    openAddonDetailsModal({
                      ...resultDetails(source),
                      installLabel: USE_LABEL,
                      onInstall: async () => use(source),
                    })
                  }
                />
              ))}
            </DialogControlsSection>
          )}
        </ScrollBuffer>
      </DialogBody>
      <DialogFooter>
        <DialogButton onClick={closeModal}>Cancel</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

export function openFindSourceModal(addon: Addon, onPick: (source: SearchResult) => void): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <FindSourceModal addon={addon} onPick={onPick} closeModal={close} />,
    window,
    { strTitle: sourceTitle(addon), bHideMainWindowForPopouts: false },
  );
}
