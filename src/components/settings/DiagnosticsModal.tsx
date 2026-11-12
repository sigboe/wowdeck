import { DialogControlsSection, Field } from "@decky/ui";
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

  openAboutModal(title, () => <DiagnosticsRows text={text} />, "focus", [
    { label: "Copy diagnostics", onClick: () => void copy() },
  ]);
}

/** Epoch-millisecond fields, shown as the player's local date and time. */
const TIMESTAMP_KEYS = new Set(["lastPush"]);

/** Nested keys whose sentence-case form would not read well. */
const NESTED_LABELS: Record<string, string> = {
  clientLabel: "Client",
  companionAddonDetected: "Companion addon",
  followedCount: "Followed realms",
  id: "Source",
  requiresApiKey: "Needs API key",
};

/** "signedIn" → "Signed in": a nested key as a label. */
function nestedLabel(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return NESTED_LABELS[key] ?? words.charAt(0).toUpperCase() + words.slice(1);
}

/** Render only the same safe allowlist as the copyable support report. */
export function DiagnosticsRows({ text }: { text: string }) {
  const labels: Record<string, string> = {
    tradeSkillMaster: "TradeSkillMaster",
    backendVersion: "Backend version",
    deckyVersion: "Decky version",
    pluginVersion: "WoWDeck version",
    platform: "Platform",
    installations: "WoW installations",
    providers: "Addon sources",
    recentErrors: "Recent errors",
    curseForgeAuth: "CurseForge access",
    githubTokenConfigured: "GitHub token saved",
  };
  const format = (value: unknown, key = ""): string => {
    if (value === null || value === undefined) return "Not available";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number" && TIMESTAMP_KEYS.has(key))
      return new Date(value).toLocaleString();
    if (Array.isArray(value)) return value.length ? value.map((v) => format(v)).join("; ") : "None";
    if (typeof value === "object")
      return Object.entries(value)
        .map(([k, item]) => `${nestedLabel(k)}: ${format(item, k)}`)
        .join(" · ");
    return String(value);
  };
  return (
    <DialogControlsSection>
      {Object.entries(JSON.parse(text) as Record<string, unknown>).map(([key, value]) => (
        <Field
          key={key}
          focusable
          label={labels[key] ?? key}
          description={<span style={{ overflowWrap: "anywhere" }}>{format(value)}</span>}
        />
      ))}
    </DialogControlsSection>
  );
}
