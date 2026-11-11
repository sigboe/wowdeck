import { useState, useSyncExternalStore } from "react";
import {
  DialogBody,
  DialogBodyText,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  ModalRoot,
  Spinner,
  TextField,
  showModal,
} from "@decky/ui";
import { FaChevronRight } from "react-icons/fa";
import * as api from "../../services/backend";
import { STEAM } from "../../steamTheme";
import { wowupModalStyleCss } from "../../sharedStyles";
import { pluginToast } from "../../toast";
import { errorText } from "../../errors";
import { settingsStore } from "../../settings";
import { rememberFocus } from "../../focusMemory";
import { PROVIDER_ID } from "../../../backend/src/api/providers";
import { ScrollBuffer } from "../ScrollBuffer";
import { PASSWORD_INPUT_PROPS, SettingsRow, VIEW } from "./common";

/** The GitHub row's focus-memory key in Options. */
const GITHUB_ROW = "gitHubToken";
const TITLE = "GitHub token";

const useTokenSaved = () =>
  !!useSyncExternalStore(settingsStore.subscribe, settingsStore.get).settings.githubAccessToken;

/**
 * GitHub's row in Addon sources, after the sources that can be switched off:
 * GitHub cannot be (the engine refuses), so it is a `>` row, never a toggle.
 * It works without a token; a token only raises GitHub's rate limit.
 */
export function GitHubSourceRow() {
  return (
    <SettingsRow id={GITHUB_ROW}>
      <Field
        verticalAlignment="center"
        childrenContainerWidth="min"
        focusable
        label="GitHub"
        onClick={() => {
          // The modal unmounts the panel (guide G4); Options comes back to this row (S21).
          rememberFocus(VIEW, GITHUB_ROW);
          openGitHubTokenModal();
        }}
      >
        <FaChevronRight />
      </Field>
    </SettingsRow>
  );
}

/**
 * Add, replace or clear the GitHub token. Save asks GitHub whether the token
 * works first and stores only a token it accepts; a rejected one stays in the
 * field with GitHub's reason, to correct or try again. The row reads the
 * settings store, so it shows the new status once the modal closes.
 */
function GitHubTokenModal({ closeModal }: { closeModal?: () => void }) {
  const close = () => closeModal?.();
  const saved = useTokenSaved();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const candidate = token.trim();
    setBusy(true);
    setError(null);
    try {
      const test = await api.rpc("providers.testApiKey", {
        providerId: PROVIDER_ID.GitHub,
        apiKey: candidate,
      });
      if (!test.ok) {
        setError(`GitHub didn't accept it: ${test.message}`);
        return;
      }
      await settingsStore.write({ githubAccessToken: candidate });
      pluginToast("GitHub token saved and verified");
      close();
    } catch (e) {
      setError(`Couldn't save the token: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      await settingsStore.write({ githubAccessToken: null });
      pluginToast("GitHub token cleared");
      close();
    } catch (e) {
      setError(`Couldn't clear the token: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalRoot onCancel={close} closeModal={close}>
      <DialogHeader>{TITLE}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <DialogBodyText>
            A personal access token raises GitHub's rate limit. Public addons install without one.
          </DialogBodyText>
          <DialogControlsSection>
            <TextField
              label={saved ? "New personal access token" : "Personal access token"}
              description={
                <>
                  {saved ? "A token is saved. Enter a new token to replace it." : "No token saved."}
                  {error && <span style={{ display: "block", color: STEAM.danger }}>{error}</span>}
                </>
              }
              disabled={busy}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              bIsPassword
              {...PASSWORD_INPUT_PROPS}
            />
          </DialogControlsSection>
        </ScrollBuffer>
      </DialogBody>
      <DialogFooter>
        <DialogButton disabled={busy || !token.trim()} onClick={() => void save()}>
          {busy ? <Spinner style={{ width: "1em" }} /> : null}
          Save
        </DialogButton>
        {saved && (
          <DialogButton disabled={busy} onClick={() => void clear()}>
            Remove token
          </DialogButton>
        )}
        <DialogButton onClick={close}>Cancel</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

export function openGitHubTokenModal(): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(<GitHubTokenModal closeModal={close} />, window, {
    strTitle: TITLE,
    bHideMainWindowForPopouts: false,
  });
}
