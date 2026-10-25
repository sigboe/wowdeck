import { useEffect, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
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

interface Props {
  /** Null when they could not be loaded (a Try again row). */
  providers: ProviderInfo[] | null;
  setProviders: Dispatch<SetStateAction<ProviderInfo[] | null>>;
  reloadProviders: () => Promise<void>;
  curseForgeAuth: CurseForgeAuthStatus | null;
}

/** Each addon source on or off. */
export function SourcesSection({
  providers,
  setProviders,
  reloadProviders,
  curseForgeAuth,
}: Props) {
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
                    // optimistic toggle; revert to backend truth on failure
                    setProviders(
                      (prev) =>
                        prev?.map((x) => (x.id === p.id ? { ...x, enabled: checked } : x)) ?? null,
                    );
                    try {
                      const { providers: next } = await api.rpc("providers.setEnabled", {
                        providerId: p.id,
                        enabled: checked,
                      });
                      setProviders(next);
                    } catch (e) {
                      toastError(`Couldn't change ${providerLabel(p.id)}`, e);
                      await reloadProviders();
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
