import { useEffect, useSyncExternalStore } from "react";
import { ButtonItem, PanelSection, ToggleField } from "@decky/ui";
import type { CurseForgeAuthStatus, ProviderInfo } from "../../types";
import * as api from "../../services/backend";
import { toastError } from "../../toast";
import { shouldShowCurseForgeKeySection } from "../../curseForgeAuthUi";
import { providerLabel } from "../../addonRow";
import { PROVIDER_ID } from "../../../backend/src/api/providers";
import { SettingsRow } from "./common";
import { sourceOffDescription } from "../../sourceAccess";
import { clearSourceJump, sourceJump, sourceRowKey, subscribeSourceJump } from "../../optionsJump";
import { setSourceEnabled } from "../../sourcesStore";

interface Props {
  /** Null when they could not be loaded (a Try again row). */
  providers: ProviderInfo[] | null;
  reloadProviders: () => Promise<void>;
  curseForgeAuth: CurseForgeAuthStatus | null;
}

/** Each addon source on or off. */
export function SourcesSection({ providers, reloadProviders, curseForgeAuth }: Props) {
  // The Options jump (optionsJump.ts) marks the rows it navigated for; they
  // blink until the jump is used, focus moves on, or this section leaves.
  const jump = useSyncExternalStore(subscribeSourceJump, sourceJump);
  useEffect(() => clearSourceJump, []);

  return (
    <PanelSection title="Addon sources">
      {providers === null ? (
        <SettingsRow id="loadProviders">
          <ButtonItem layout="below" onClick={() => void reloadProviders()}>
            Try again
          </ButtonItem>
        </SettingsRow>
      ) : (
        providers
          .filter((p) => p.allowEdit)
          .map((p) => {
            const marked = jump?.marked.has(p.id) ?? false;
            return (
              <SettingsRow
                key={p.id}
                id={sourceRowKey(p.id)}
                className={marked ? "wowdeck-source-jump" : undefined}
                // One blink for every marked row: a row that mounts later
                // starts its animation part-way through, in step with the rest.
                style={
                  marked && jump
                    ? { animationDelay: `${jump.startedAt - Date.now()}ms` }
                    : undefined
                }
              >
                <ToggleField
                  checked={p.enabled}
                  label={providerLabel(p.id)}
                  disabled={p.requiresApiKey && !p.configured}
                  description={
                    p.requiresApiKey && !p.configured
                      ? "Needs an API key (see CurseForge above)"
                      : p.requiresApiKey &&
                          // "Your key" only when the bundled key isn't the one in use,
                          // the same rule as the CurseForge section (curseForgeAuthUi.ts).
                          (p.id !== PROVIDER_ID.Curse ||
                            !curseForgeAuth ||
                            shouldShowCurseForgeKeySection(curseForgeAuth))
                        ? "Using your API key"
                        : !p.enabled
                          ? (sourceOffDescription(p.id) ?? undefined)
                          : undefined
                  }
                  onChange={async (checked) => {
                    // The marked row was used: the attention effect has done its job.
                    if (marked) {
                      clearSourceJump();
                    }
                    // Shown at once; the store goes back to the engine's list on failure.
                    try {
                      await setSourceEnabled(api.rpc, p.id, checked);
                    } catch (e) {
                      toastError(`Couldn't change ${providerLabel(p.id)}`, e);
                    }
                  }}
                />
              </SettingsRow>
            );
          })
      )}
    </PanelSection>
  );
}
