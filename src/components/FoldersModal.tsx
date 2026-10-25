import { useEffect, useState } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  ModalRoot,
  Navigation,
  showModal,
} from "@decky/ui";
import { FaCopy, FaFolderOpen } from "react-icons/fa";
import * as api from "../services/backend";
import { STEAM, descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import { ScrollBuffer } from "./ScrollBuffer";
import type { Addon, AddonFolders } from "../types";
import { homePath } from "../installationDetails";
import { NO_FILE_MANAGER_HINT, showRow } from "../addonFolders";
import { errorText } from "../errors";
import { pluginToast, toastError } from "../toast";
import { switchToRunningApp } from "../steamDom/runningApp";

/**
 * The Folders dialog (WF-20; My Addons row menu): where an addon's files
 * are. Show opens them in a file manager that is already running (never
 * starts one) and, when that runs as a Steam app (Dolphin as a non-Steam
 * game, a nested desktop), switches to it; each folder row copies its path. Like InstallationDetailsModal
 * it is built from Steam's dialog components; B closes.
 */
function FoldersModal({ addon, closeModal }: { addon: Addon; closeModal?: () => void }) {
  const close = () => closeModal?.();
  const [state, setState] = useState<{ value: AddonFolders | null; error: string | null }>({
    value: null,
    error: null,
  });

  // Asked again after every Show: a file manager may have opened or closed.
  const load = () =>
    api.rpc("addons.folders", { addonId: addon.id }).then(
      (value) => setState({ value, error: null }),
      (e) => setState({ value: null, error: errorText(e) }),
    );
  useEffect(() => {
    void load();
  }, []);

  const show = async () => {
    try {
      const { shown, steamAppId } = await api.rpc("addons.showFolders", { addonId: addon.id });
      if (!shown) {
        pluginToast(NO_FILE_MANAGER_HINT.title, NO_FILE_MANAGER_HINT.body);
      } else if (steamAppId !== null) {
        close();
        Navigation.CloseSideMenus();
        if (!switchToRunningApp(steamAppId)) {
          pluginToast(
            "Folders opened",
            "Switch to your file manager from the Steam menu to see them.",
          );
        }
        return;
      }
    } catch (e) {
      toastError("Couldn't show the folders", e);
    }
    void load();
  };

  const copy = async (path: string) => {
    try {
      // navigator.clipboard is not available here; main.py runs the bundled xclip.
      const { ok, message } = await api.copyTextToClipboard(path);
      pluginToast(ok ? "Path copied" : "Couldn't copy the path", ok ? homePath(path) : message);
    } catch (e) {
      toastError("Couldn't copy the path", e);
    }
  };

  const folders = state.value;
  const showInfo = folders && showRow(folders.fileManager);
  return (
    <ModalRoot onCancel={close} closeModal={close} bAllowFullSize>
      <DialogHeader>{addon.name}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        {/* Read-only rows are focusable so the D-pad scrolls to every one (F4). */}
        <ScrollBuffer>
          <DialogControlsSection>
            {!folders && (
              <Field focusable label={state.error ? "Couldn't read the folders" : "Loading…"}>
                {state.error && <span style={{ color: STEAM.danger }}>{state.error}</span>}
              </Field>
            )}
            {folders && showInfo && (
              <>
                <Field
                  focusable
                  label={
                    showInfo.muted ? (
                      <span style={{ opacity: 0.5 }}>{showInfo.label}</span>
                    ) : (
                      showInfo.label
                    )
                  }
                  description={<span style={descriptionStyle}>{showInfo.description}</span>}
                  onClick={() => void show()}
                >
                  <FaFolderOpen style={showInfo.muted ? { opacity: 0.5 } : undefined} />
                </Field>
                <Field focusable label="AddOns folder" childrenLayout="below">
                  {homePath(folders.addonsPath)}
                </Field>
                {folders.folders.map((f) => (
                  <Field
                    key={f.name}
                    focusable
                    label={f.name}
                    description={
                      f.present ? undefined : (
                        <span style={{ ...descriptionStyle, color: STEAM.warning }}>
                          Missing from AddOns
                        </span>
                      )
                    }
                    onOKActionDescription="Copy path"
                    onClick={() => void copy(f.path)}
                  >
                    <FaCopy />
                  </Field>
                ))}
              </>
            )}
          </DialogControlsSection>
        </ScrollBuffer>
      </DialogBody>
      <DialogFooter>
        <DialogButton onClick={close}>Close</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

export function openFoldersModal(addon: Addon): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(<FoldersModal addon={addon} closeModal={close} />, window, {
    strTitle: `${addon.name} folders`,
    bHideMainWindowForPopouts: false,
  });
}
