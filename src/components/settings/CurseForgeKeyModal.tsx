import { RowChevron } from "../RowChevron";
import { useEffect, useRef, useState } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  ModalRoot,
  Navigation,
  TextField,
  showModal,
} from "@decky/ui";
import { FaSave, FaSync, FaTrash } from "react-icons/fa";
import type { CurseForgeAuthStatus } from "../../types";
import * as api from "../../services/backend";
import { descriptionStyle } from "../../steamTheme";
import { wowupModalStyleCss } from "../../sharedStyles";
import { pluginToast, toastError } from "../../toast";
import { settingsStore } from "../../settings";
import { setSourceEnabled } from "../../sourcesStore";
import { userKeyStatusLabel } from "../../curseForgeAuthUi";
import { requestFocus } from "../../focusMemory";
import { CURSE_KEY_ROW } from "../../optionsJump";
import { PROVIDER_ID } from "../../../backend/src/api/providers";
import { ScrollBuffer } from "../ScrollBuffer";
import { TextRow } from "../TextRow";
import { PASSWORD_INPUT_PROPS, VIEW, busyIcon } from "./common";

const CURSEFORGE_API_KEYS_URL = "https://console.curseforge.com/#/api-keys";

interface Props {
  /** Null while Options is still loading it: the modal asks itself. */
  auth: CurseForgeAuthStatus | null;
  /** A key was saved or cleared, or built-in access checked again: reload what Options shows. */
  onChanged: () => Promise<void>;
  closeModal?: () => void;
}

/** Why the player is here: built-in access, when it exists, isn't usable. */
function builtInNote(auth: CurseForgeAuthStatus): string {
  if (!auth.bundledPresent) {
    return "This version has no built-in CurseForge access. Add your own API key.";
  }
  if (auth.bundledStatus === "valid") {
    return "Built-in CurseForge access works.";
  }
  return "Built-in CurseForge access isn't working right now. You can add your own API key.";
}

/**
 * The CurseForge key modal, opened from CurseForge's row in Addon sources:
 * the `>` row while no key is usable, the toggle's Options button (≡) "API
 * key" while the player's own key is in use (curseForgeAuthUi.ts). Status
 * first, then the key and its actions. A saved key turns CurseForge on.
 */
export function CurseForgeKeyModal({ auth: initialAuth, onChanged, closeModal }: Props) {
  const close = () => closeModal?.();
  const [auth, setAuth] = useState(initialAuth);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  const statusRequest = useRef(0);

  // The status may have moved on since the row was drawn.
  useEffect(() => {
    const request = ++statusRequest.current;
    void api
      .rpc("curseforge.authStatus")
      .then((next) => request === statusRequest.current && setAuth(next))
      .catch(() => {
        /* Keep the row's status. */
      });
    return () => {
      statusRequest.current++;
    };
  }, []);

  const reloadAuth = async () => {
    const request = ++statusRequest.current;
    try {
      const next = await api.rpc("curseforge.authStatus");
      if (request === statusRequest.current) setAuth(next);
    } catch {
      /* Keep the last status. */
    }
  };

  const save = async () => {
    const candidate = key.trim();
    if (busy || rechecking || !candidate) {
      return;
    }
    statusRequest.current++;
    setBusy(true);
    try {
      // Instant feedback before saving; settings.set records the real check.
      const test = await api.rpc("providers.testApiKey", {
        providerId: PROVIDER_ID.Curse,
        apiKey: candidate,
      });
      if (!test.ok && test.confirmed !== false) {
        pluginToast("Couldn't check the key", test.message);
        return;
      }
      await settingsStore.write({ curseApiKey: candidate });
      setKey("");
      pluginToast(
        test.ok ? "CurseForge key saved and verified" : "CurseForge key saved",
        test.ok ? "" : "Couldn't verify it just now (network or CurseForge issue). Saved anyway.",
      );
      try {
        await setSourceEnabled(api.rpc, PROVIDER_ID.Curse, true);
      } catch (e) {
        toastError("Couldn't turn on CurseForge", e);
      }
      await onChanged();
      close();
    } catch (e) {
      toastError("Couldn't save key", e);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy || rechecking) {
      return;
    }
    statusRequest.current++;
    setBusy(true);
    try {
      await settingsStore.write({ curseApiKey: null });
      pluginToast("CurseForge key cleared");
      await reloadAuth();
      await onChanged();
    } catch (e) {
      toastError("Couldn't clear key", e);
    } finally {
      setBusy(false);
    }
  };

  const recheckBuiltIn = async () => {
    if (busy || rechecking) {
      return;
    }
    const request = ++statusRequest.current;
    setRechecking(true);
    try {
      const next = await api.rpc("curseforge.recheckBundledKey");
      if (request === statusRequest.current) setAuth(next);
      await onChanged();
    } catch (e) {
      toastError("Couldn't try built-in access again", e);
    } finally {
      setRechecking(false);
    }
  };

  const canSave = !busy && !rechecking && !!key.trim();
  return (
    <ModalRoot onCancel={close} closeModal={close} bAllowFullSize>
      <DialogHeader>CurseForge API key</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <DialogControlsSection>
            {/* Read-only, focusable so the D-pad reaches it (F4). */}
            <Field
              focusable
              label={auth ? userKeyStatusLabel(auth) : "Checking CurseForge access…"}
              description={
                auth ? <span style={descriptionStyle}>{builtInNote(auth)}</span> : undefined
              }
            />
            <TextRow label="Your CurseForge API key" layout="inline">
              <TextField
                value={key}
                onChange={(e) => setKey(e.target.value)}
                bIsPassword
                aria-label="CurseForge API key"
                {...PASSWORD_INPUT_PROPS}
              />
            </TextRow>
            <Field
              focusable
              label={auth?.userConfigured ? "Replace key" : "Save key"}
              disabled={!canSave}
              description={
                <span style={descriptionStyle}>Checked with CurseForge before it's saved</span>
              }
              onClick={() => void save()}
            >
              {busyIcon(busy, <FaSave />)}
            </Field>
            {auth?.userConfigured && (
              <Field
                focusable
                label="Clear key"
                disabled={busy || rechecking}
                onClick={() => void clear()}
              >
                <FaTrash />
              </Field>
            )}
            {auth?.bundledPresent && auth.bundledStatus === "invalid" && (
              <Field
                focusable
                label="Try built-in access again"
                disabled={busy || rechecking}
                description={
                  <span style={descriptionStyle}>
                    In case CurseForge only blocked it for a while
                  </span>
                }
                onClick={() => void recheckBuiltIn()}
              >
                {busyIcon(rechecking, <FaSync />)}
              </Field>
            )}
            <Field
              focusable
              label="Get a CurseForge API key"
              description={
                <span style={descriptionStyle}>Opens the CurseForge console in the browser</span>
              }
              onClick={() => Navigation.NavigateToExternalWeb(CURSEFORGE_API_KEYS_URL)}
            >
              <RowChevron />
            </Field>
          </DialogControlsSection>
        </ScrollBuffer>
      </DialogBody>
      <DialogFooter>
        <DialogButton onClick={close}>Close</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

/**
 * Open the key modal. Closing it puts focus back on CurseForge's source row
 * (guide S21), whichever shape the row has by then: a saved key turns the
 * `>` row into a toggle under the same focus key.
 */
export function openCurseForgeKeyModal(
  auth: CurseForgeAuthStatus | null,
  onChanged: () => Promise<void>,
): void {
  const close = () => {
    modalResult.Close();
    requestFocus(VIEW, CURSE_KEY_ROW);
  };
  const modalResult = showModal(
    <CurseForgeKeyModal auth={auth} onChanged={onChanged} closeModal={close} />,
    window,
    {
      strTitle: "CurseForge API key",
      bHideMainWindowForPopouts: false,
    },
  );
}
