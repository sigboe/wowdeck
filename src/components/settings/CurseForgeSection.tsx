import { useState } from "react";
import {
  ButtonItem,
  Field,
  Navigation,
  PanelSection,
  PanelSectionRow,
  Spinner,
  TextField,
} from "@decky/ui";
import { FaChevronRight, FaSync } from "react-icons/fa";
import type { CurseForgeAuthStatus } from "../../types";
import * as api from "../../services/backend";
import { descriptionStyle } from "../../steamTheme";
import { pluginToast, toastError } from "../../toast";
import { settingsStore } from "../../settings";
import { shouldShowCurseForgeKeySection, userKeyStatusLabel } from "../../curseForgeAuthUi";
import { PROVIDER_ID } from "../../../backend/src/api/providers";
import { TextRow } from "../TextRow";
import { CURSE_KEY_ROW, PASSWORD_INPUT_PROPS, SettingsRow, busyIcon } from "./common";

const CURSEFORGE_API_KEYS_URL = "https://console.curseforge.com/#/api-keys";

interface Props {
  /** Null while loading. */
  curseForgeAuth: CurseForgeAuthStatus | null;
  setCurseForgeAuth: (auth: CurseForgeAuthStatus) => void;
  /** A key was saved or cleared: the providers and the auth status changed. */
  onKeyChanged: () => Promise<void>;
}

/**
 * The user's own CurseForge key. The bundled key is the normal source; this
 * section only appears when it isn't usable (curseForgeAuthUi.ts decides).
 */
export function CurseForgeSection({ curseForgeAuth, setCurseForgeAuth, onKeyChanged }: Props) {
  const [cfKey, setCfKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [recheckingBundled, setRecheckingBundled] = useState(false);

  const saveCurseKey = async () => {
    const candidate = cfKey.trim();
    setSavingKey(true);
    try {
      // Instant feedback before saving; settings.set records the real check.
      const test = await api.rpc("providers.testApiKey", {
        providerId: PROVIDER_ID.Curse,
        apiKey: candidate || undefined,
      });
      if (!test.ok && test.confirmed !== false) {
        pluginToast("Couldn't check the key", test.message);
        return;
      }
      await settingsStore.write({ curseApiKey: candidate });
      setCfKey("");
      pluginToast(
        test.ok ? "CurseForge key saved and verified" : "CurseForge key saved",
        test.ok ? "" : "Couldn't verify it just now (network or CurseForge issue). Saved anyway.",
      );
      await onKeyChanged();
    } catch (e) {
      toastError("Couldn't save key", e);
    } finally {
      setSavingKey(false);
    }
  };

  const clearCurseKey = async () => {
    setSavingKey(true);
    try {
      await settingsStore.write({ curseApiKey: null });
      pluginToast("CurseForge key cleared");
      await onKeyChanged();
    } catch (e) {
      toastError("Couldn't clear key", e);
    } finally {
      setSavingKey(false);
    }
  };

  const recheckBundled = async () => {
    setRecheckingBundled(true);
    try {
      setCurseForgeAuth(await api.rpc("curseforge.recheckBundledKey"));
    } catch (e) {
      toastError("Couldn't try built-in access again", e);
    } finally {
      setRecheckingBundled(false);
    }
  };

  if (curseForgeAuth && !shouldShowCurseForgeKeySection(curseForgeAuth)) {
    return null;
  }
  return (
    <PanelSection title="CurseForge">
      {!curseForgeAuth ? (
        <PanelSectionRow>
          <div style={descriptionStyle}>Loading…</div>
        </PanelSectionRow>
      ) : (
        <>
          <SettingsRow id={CURSE_KEY_ROW}>
            <TextRow
              label="Your CurseForge API key"
              description={
                (curseForgeAuth.bundledPresent
                  ? "Built-in CurseForge access isn't working right now. You can add your own API key. "
                  : "") + userKeyStatusLabel(curseForgeAuth)
              }
            >
              <TextField
                value={cfKey}
                onChange={(e) => setCfKey(e.target.value)}
                bIsPassword
                {...PASSWORD_INPUT_PROPS}
              />
            </TextRow>
          </SettingsRow>
          <SettingsRow id="saveCurseKey">
            <ButtonItem layout="below" disabled={savingKey || !cfKey.trim()} onClick={saveCurseKey}>
              {savingKey ? <Spinner style={{ width: "1em" }} /> : null}{" "}
              {curseForgeAuth.userConfigured ? "Replace key" : "Save key"}
            </ButtonItem>
          </SettingsRow>
          {curseForgeAuth.userConfigured && (
            <SettingsRow id="clearCurseKey">
              <ButtonItem layout="below" disabled={savingKey} onClick={clearCurseKey}>
                Clear key
              </ButtonItem>
            </SettingsRow>
          )}
          {curseForgeAuth.bundledPresent && curseForgeAuth.bundledStatus === "invalid" && (
            <SettingsRow id="recheckBundled">
              <Field
                focusable
                label="Try built-in access again"
                description={
                  <span style={descriptionStyle}>
                    In case CurseForge only blocked it for a while
                  </span>
                }
                onClick={() => !recheckingBundled && void recheckBundled()}
              >
                {busyIcon(recheckingBundled, <FaSync />)}
              </Field>
            </SettingsRow>
          )}
          <SettingsRow id="getCurseKey">
            <Field
              focusable
              label="Get a CurseForge API key"
              description={
                <span style={descriptionStyle}>Opens the CurseForge console in the browser</span>
              }
              onClick={() => Navigation.NavigateToExternalWeb(CURSEFORGE_API_KEYS_URL)}
            >
              <FaChevronRight />
            </Field>
          </SettingsRow>
        </>
      )}
    </PanelSection>
  );
}
