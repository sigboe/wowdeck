import { UpdateDot } from "../UpdateDot";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ButtonItem, Field, Navigation, PanelSection, ToggleField } from "@decky/ui";
import { FaChevronRight } from "react-icons/fa";
import type { CurseForgeAuthStatus, ProviderInfo } from "../../types";
import * as api from "../../services/backend";
import { toastError } from "../../toast";
import { curseForgeRowState } from "../../curseForgeAuthUi";
import { descriptionStyle } from "../../steamTheme";
import { openCurseForgeKeyModal } from "./CurseForgeKeyModal";
import { providerLabel } from "../../addonRow";
import { PROVIDER_ID } from "../../../backend/src/api/providers";
import { SettingsRow } from "./common";
import { sourceOffDescription } from "../../sourceAccess";
import { clearSourceJump, sourceJump, sourceRowKey, subscribeSourceJump } from "../../optionsJump";
import { setSourceEnabled } from "../../sourcesStore";
import { GitHubSourceRow } from "./GitHubSource";

import { startTsmSignIn } from "../../tsmSignIn";
import { openPanel } from "../../openPanel";

const signInBrowser = {
  open: (url: string) => Navigation.NavigateToExternalWeb(url),
  // Back to Options, where sign-in started: the QAM closed when the browser opened.
  close: () => {
    Navigation.NavigateBack();
    openPanel("settings");
  },
};
import type { TradeSkillMasterAuthStatus } from "../../../backend/src/api/contracts";

interface Props {
  /** Null when they could not be loaded (a Try again row). */
  providers: ProviderInfo[] | null;
  reloadProviders: () => Promise<void>;
  /** Null while loading. */
  curseForgeAuth: CurseForgeAuthStatus | null;
  /** The key modal saved or cleared a key: reload the CurseForge status. */
  onCurseForgeKeyChanged: () => Promise<void>;
}

/**
 * Each addon source on or off, then GitHub's token row (GitHub is always
 * on). CurseForge's row also sets up its key
 * (curseForgeAuthUi.ts): a `>` row while no key is usable, else a toggle,
 * whose Options button (≡) "API key" opens the same modal while the
 * player's own key is in use.
 */
export function SourcesSection({
  providers,
  reloadProviders,
  curseForgeAuth,
  onCurseForgeKeyChanged,
}: Props) {
  // The Options jump (optionsJump.ts) marks the rows it navigated for; they
  // blink until the jump is used, focus moves on, or this section leaves.
  const [tsm, setTsm] = useState<TradeSkillMasterAuthStatus | null>(null);
  useEffect(() => {
    let live = true;
    let reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const status = await api.rpc("tradeskillmaster.status");
        if (live) {
          setTsm(status);
          await reloadProviders();
        }
      } catch {
        /* Engine not ready; retry when Options reopens. */
      } finally {
        reading = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 1000);
    return () => {
      live = false;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [reloadProviders, tsm?.state]);
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
            const curseRow =
              p.id === PROVIDER_ID.Curse ? curseForgeRowState(p, curseForgeAuth) : null;
            const openKey = () => {
              if (marked) {
                clearSourceJump();
              }
              openCurseForgeKeyModal(curseForgeAuth, onCurseForgeKeyChanged);
            };
            // Off keeps the TradeSkillMaster account; X forgets it.
            const tsmAccount =
              p.id === PROVIDER_ID.TradeSkillMaster &&
              (!!tsm?.account || tsm?.state === "signedOut");
            return (
              <SettingsRow
                key={p.id}
                actions={
                  curseRow === "ownKeyToggle"
                    ? { onOptionsButton: openKey, onOptionsActionDescription: "API key" }
                    : tsmAccount
                      ? {
                          onSecondaryActionDescription: "Sign out",
                          onSecondaryButton: () => {
                            void api
                              .rpc("tradeskillmaster.signOut")
                              .then(async (status) => {
                                setTsm(status);
                                await reloadProviders();
                              })
                              .catch((e) => toastError("Couldn't sign out of TradeSkillMaster", e));
                          },
                        }
                      : undefined
                }
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
                {curseRow === "keyRow" ? (
                  <Field
                    verticalAlignment="center"
                    childrenContainerWidth="min"
                    focusable
                    label={providerLabel(p.id)}
                    description={<span style={descriptionStyle}>Needs an API key</span>}
                    onClick={openKey}
                  >
                    <FaChevronRight />
                  </Field>
                ) : (
                  <>
                    {p.id === PROVIDER_ID.TradeSkillMaster && tsm?.state === "signedOut" && (
                      <div style={{ position: "relative" }}>
                        <UpdateDot color="action" />
                      </div>
                    )}
                    <ToggleField
                      checked={p.enabled}
                      label={
                        p.id === PROVIDER_ID.TradeSkillMaster && tsm?.account
                          ? `TradeSkillMaster · ${tsm.account}`
                          : providerLabel(p.id)
                      }
                      disabled={p.requiresApiKey && !p.configured}
                      description={
                        p.requiresApiKey && !p.configured
                          ? "Needs an API key"
                          : curseRow === "ownKeyToggle"
                            ? "Using your API key"
                            : tsmAccount && !p.enabled
                              ? "Your account stays signed in while off. X signs out."
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
                          if (
                            p.id === PROVIDER_ID.TradeSkillMaster &&
                            checked &&
                            tsm?.state !== "signedIn" &&
                            !tsm?.account
                          ) {
                            await startTsmSignIn(api.rpc, signInBrowser);
                            setTsm(await api.rpc("tradeskillmaster.status"));
                          } else {
                            await setSourceEnabled(api.rpc, p.id, checked);
                          }
                        } catch (e) {
                          toastError(`Couldn't change ${providerLabel(p.id)}`, e);
                        }
                      }}
                    />
                    {p.id === PROVIDER_ID.TradeSkillMaster && tsm?.state === "signedOut" && (
                      <ButtonItem
                        layout="below"
                        onClick={async () => {
                          await startTsmSignIn(api.rpc, signInBrowser);
                          setTsm(await api.rpc("tradeskillmaster.status"));
                        }}
                      >
                        Sign in
                      </ButtonItem>
                    )}
                    {p.id === PROVIDER_ID.TradeSkillMaster && tsm?.state === "signingIn" && (
                      <ButtonItem
                        layout="below"
                        onClick={async () => {
                          setTsm(await api.rpc("tradeskillmaster.cancel"));
                          await reloadProviders();
                        }}
                      >
                        Cancel sign-in
                      </ButtonItem>
                    )}
                  </>
                )}
              </SettingsRow>
            );
          })
      )}
      <GitHubSourceRow />
    </PanelSection>
  );
}
