import { useState, useSyncExternalStore } from "react";
import { ButtonItem, Field, PanelSection, Spinner, TextField } from "@decky/ui";
import { FaTrash } from "react-icons/fa";
import * as api from "../../services/backend";
import { descriptionStyle } from "../../steamTheme";
import { pluginToast, toastError } from "../../toast";
import { settingsStore } from "../../settings";
import { PROVIDER_ID } from "../../../backend/src/api/providers";
import { TextRow } from "../TextRow";
import { PASSWORD_INPUT_PROPS, SettingsRow, busyIcon } from "./common";

/** GitHub works without a token; a token only raises the API rate limit. */
export function GitHubSection() {
  const [ghToken, setGhToken] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const ghConfigured = !!useSyncExternalStore(settingsStore.subscribe, settingsStore.get).settings
    .githubAccessToken;

  const saveGitHubToken = async () => {
    const candidate = ghToken.trim();
    setSavingToken(true);
    try {
      const test = await api.rpc("providers.testApiKey", {
        providerId: PROVIDER_ID.GitHub,
        apiKey: candidate || undefined,
      });
      if (!test.ok) {
        pluginToast("Couldn't check the token", test.message);
        return;
      }
      await settingsStore.write({ githubAccessToken: candidate });
      setGhToken("");
      pluginToast("GitHub token saved and verified");
    } catch (e) {
      toastError("Couldn't save token", e);
    } finally {
      setSavingToken(false);
    }
  };

  const clearGitHubToken = async () => {
    setSavingToken(true);
    try {
      await settingsStore.write({ githubAccessToken: null });
      pluginToast("GitHub token cleared");
    } catch (e) {
      toastError("Couldn't clear token", e);
    } finally {
      setSavingToken(false);
    }
  };

  return (
    <PanelSection title="GitHub">
      {ghConfigured ? (
        <SettingsRow id="clearGitHubToken">
          <Field
            focusable
            label="Clear access token"
            description={<span style={descriptionStyle}>A token is saved (hidden)</span>}
            onClick={() => !savingToken && void clearGitHubToken()}
          >
            {busyIcon(savingToken, <FaTrash />)}
          </Field>
        </SettingsRow>
      ) : (
        <>
          <SettingsRow id="gitHubToken">
            <TextRow
              label="Personal access token (optional)"
              description="Raises GitHub's rate limit. Public addons install without one."
            >
              <TextField
                value={ghToken}
                onChange={(e) => setGhToken(e.target.value)}
                bIsPassword
                {...PASSWORD_INPUT_PROPS}
              />
            </TextRow>
          </SettingsRow>
          <SettingsRow id="saveGitHubToken">
            <ButtonItem
              layout="below"
              disabled={savingToken || !ghToken.trim()}
              onClick={saveGitHubToken}
            >
              {savingToken ? <Spinner style={{ width: "1em" }} /> : null} Save token
            </ButtonItem>
          </SettingsRow>
        </>
      )}
    </PanelSection>
  );
}
