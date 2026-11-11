import { useEffect, useSyncExternalStore } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogHeader,
  Field,
  ModalRoot,
  ToggleField,
  showModal,
} from "@decky/ui";
import * as api from "../services/backend";
import { settingsStore } from "../settings";
import { createStore } from "../store";
import { descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import { pluginToast, toastError } from "../toast";
import { formatBytes } from "../wtfFormat";
import { previousVersionsUsageLine, type PreviousVersionsUsage } from "../previousVersions";

const TITLE = "Previous versions";

/**
 * The space kept previous versions use, shared by the Options row and its
 * modal: the panel is torn down while the modal is open (G4), and a clear
 * there must show on the row too. `usage` null means loading or a failed
 * load, distinguished by `error`.
 */
export const previousVersionsStore = createStore<{
  usage: PreviousVersionsUsage | null;
  clearing: boolean;
  error: boolean;
}>({ usage: null, clearing: false, error: false });

let usageRequest = 0;

export function loadPreviousVersionsUsage(): Promise<void> {
  const request = ++usageRequest;
  previousVersionsStore.patch({ usage: null, error: false });
  return api
    .rpc("rollback.status")
    .then((usage) => {
      if (request === usageRequest) previousVersionsStore.patch({ usage, error: false });
    })
    .catch(() => {
      if (request === usageRequest) previousVersionsStore.patch({ usage: null, error: true });
    });
}

async function clearPreviousVersions(): Promise<void> {
  usageRequest++;
  previousVersionsStore.patch({ clearing: true });
  try {
    const before = previousVersionsStore.get().usage;
    previousVersionsStore.patch({ usage: await api.rpc("rollback.clear") });
    pluginToast(
      "Previous versions cleared",
      before
        ? `${formatBytes(before.bytes)} freed`
        : "Rollback is no longer possible for earlier updates",
    );
  } catch (e) {
    toastError("Couldn't clear", e);
  } finally {
    previousVersionsStore.patch({ clearing: false });
  }
}

/**
 * Options › Updates › Previous versions (BEYOND-02, #207): keep each
 * addon's previous version after an update, the space kept versions use,
 * and Clear. Clear is disabled while nothing is kept.
 */
export function PreviousVersionsModal({ closeModal }: { closeModal?: () => void }) {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  const { usage, clearing, error } = useSyncExternalStore(
    previousVersionsStore.subscribe,
    previousVersionsStore.get,
  );
  useEffect(() => {
    void loadPreviousVersionsUsage();
  }, []);

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>{TITLE}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
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
                {error
                  ? "Couldn't load previous versions"
                  : usage
                    ? previousVersionsUsageLine(usage)
                    : "…"}
              </span>
            }
          >
            <DialogButton
              style={{ minWidth: 0, width: "auto", padding: "8px 16px" }}
              disabled={clearing || !usage?.count}
              onClick={() => void clearPreviousVersions()}
            >
              Clear
            </DialogButton>
          </Field>
          {error && (
            <DialogButton onClick={() => void loadPreviousVersionsUsage()}>Try again</DialogButton>
          )}
        </DialogControlsSection>
      </DialogBody>
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
