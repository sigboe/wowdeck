import * as api from "../../services/backend";
import { copyText } from "../../services/clipboard";
import { pluginToast, toastError } from "../../toast";
import { diagnosticsText } from "../../diagnostics";
import { diagnosticsStore } from "../../diagnosticsStore";
import { openAboutModal } from "../AboutModal";

/**
 * Options › About › Diagnostics: load the diagnostics afresh (local only,
 * no network) into the shared store (Notifications reads the companion
 * status from it), then show their text with Copy in an About modal. The text
 * is diagnosticsText's allowlist: no paths, keys or tokens.
 */
export async function openDiagnosticsModal(title: string): Promise<void> {
  let text: string;
  try {
    const diagnostics = await api.rpc("system.diagnostics");
    diagnosticsStore.set({ diagnostics });
    text = diagnosticsText(diagnostics);
  } catch (e) {
    toastError("Couldn't load diagnostics", e);
    return;
  }

  const copy = async () => {
    try {
      const { ok, message } = await copyText(text);
      pluginToast(
        ok ? "Diagnostics copied" : "Couldn't copy. Select the text above instead.",
        ok ? "" : message,
      );
    } catch (e) {
      toastError("Couldn't copy", e);
    }
  };

  openAboutModal(
    title,
    () => <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>{text}</pre>,
    "direct",
    [{ label: "Copy", onClick: () => void copy() }],
  );
}
