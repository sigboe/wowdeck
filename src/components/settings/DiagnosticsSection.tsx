import { useState } from "react";
import { ButtonItem, Focusable, PanelSection, ToggleField } from "@decky/ui";
import type { Diagnostics } from "../../types";
import * as api from "../../services/backend";
import { descriptionStyle } from "../../steamTheme";
import { pluginToast, toastError } from "../../toast";
import { diagnosticsText } from "../../diagnostics";
import { SettingsRow } from "./common";

interface Props {
  diagnostics: Diagnostics | null;
  setDiagnostics: (diagnostics: Diagnostics) => void;
}

/** The diagnostics text, shown on request, and a copy button. */
export function DiagnosticsSection({ diagnostics, setDiagnostics }: Props) {
  const [showDiag, setShowDiag] = useState(false);

  const toggleDiagnostics = async () => {
    if (showDiag) {
      setShowDiag(false);
      return;
    }
    try {
      setDiagnostics(await api.rpc("system.diagnostics"));
      setShowDiag(true);
    } catch (e) {
      toastError("Couldn't load diagnostics", e);
    }
  };

  const copyDiagnostics = async () => {
    if (!diagnostics) {
      return;
    }
    try {
      // navigator.clipboard is not available here; the engine shells out to
      // a bundled xclip (THIRD_PARTY_NOTICES.md).
      const { ok, message } = await api.copyTextToClipboard(diagnosticsText(diagnostics));
      pluginToast(
        ok ? "Diagnostics copied" : "Couldn't copy. Select the text above instead.",
        ok ? "" : message,
      );
    } catch (e) {
      toastError("Couldn't copy", e);
    }
  };

  return (
    <PanelSection title="Diagnostics">
      <SettingsRow id="showDiagnostics">
        <ToggleField
          label="Show diagnostics"
          checked={showDiag}
          onChange={() => void toggleDiagnostics()}
        />
      </SettingsRow>
      {showDiag && diagnostics && (
        <>
          <SettingsRow id="diagnosticsText">
            {/* A bare <pre> can't take controller focus; Focusable makes it scrollable. */}
            <Focusable style={{ maxHeight: "220px", overflowY: "auto", display: "block" }}>
              <pre
                style={{
                  ...descriptionStyle,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  margin: 0,
                }}
              >
                {diagnosticsText(diagnostics)}
              </pre>
            </Focusable>
          </SettingsRow>
          <SettingsRow id="copyDiagnostics">
            <ButtonItem layout="below" onClick={copyDiagnostics}>
              Copy diagnostics
            </ButtonItem>
          </SettingsRow>
        </>
      )}
    </PanelSection>
  );
}
