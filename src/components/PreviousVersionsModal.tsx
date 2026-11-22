import { useSyncExternalStore } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  ModalRoot,
  ToggleField,
  showModal,
} from "@decky/ui";
import { settingsStore } from "../settings";
import { ScrollBuffer } from "./ScrollBuffer";
import { descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import { previousVersionsUsageLine } from "../previousVersions";
import {
  clearPreviousVersions,
  usePreviousVersionsClearing,
  usePreviousVersionsUsage,
} from "../previousVersionsUsage";

const TITLE = "Previous versions";

/**
 * Options › Updates › Previous versions (BEYOND-02, #207): keep each
 * addon's previous version after an update, the space kept versions use,
 * and Clear. Clear is disabled while nothing is kept.
 */
export function PreviousVersionsModal({ closeModal }: { closeModal?: () => void }) {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const { data: usage, error, refresh } = usePreviousVersionsUsage();
  const clearing = usePreviousVersionsClearing();

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>{TITLE}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <DialogControlsSection>
            <ToggleField
              label="Keep previous versions"
              description={
                <span style={descriptionStyle}>
                  After an update, an addon's Options menu can roll it back
                </span>
              }
              checked={settings.keepPreviousVersions}
              onChange={(on) => void settingsStore.save({ keepPreviousVersions: on })}
            />
            <Field
              label="Space used"
              description={
                <span style={descriptionStyle}>
                  {error ? error : usage ? previousVersionsUsageLine(usage) : "…"}
                </span>
              }
            />
            <Field
              focusable
              label={clearing ? "Clearing previous versions…" : "Clear previous versions"}
              disabled={clearing || !!error || !usage?.count}
              onClick={() => !clearing && !error && !!usage?.count && void clearPreviousVersions()}
              onOKActionDescription="Clear"
            />
            {error && (
              <Field
                focusable
                label="Try again"
                onClick={() => void refresh()}
                onOKActionDescription="Retry"
              />
            )}
          </DialogControlsSection>
        </ScrollBuffer>
      </DialogBody>
      <DialogFooter>
        <DialogButton onClick={closeModal}>Close</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

export function openPreviousVersionsModal(): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(<PreviousVersionsModal closeModal={close} />, window, {
    strTitle: TITLE,
    bHideMainWindowForPopouts: false,
  });
}
