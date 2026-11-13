import { RowGlyph } from "./RowGlyph";
import {
  DialogBody,
  DialogControlsSection,
  DialogHeader,
  Field,
  ModalRoot,
  ToggleField,
  showModal,
} from "@decky/ui";
import { useState } from "react";
import { FaCheck } from "react-icons/fa";
import { STEAM, descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import { UPDATE_CHANNEL_ROWS } from "../pluginUpdate";
import type { UpdateChannel } from "../types";

const TITLE = "WoWDeck Update Channel";

/**
 * Pick WoWDeck's update channel (Options › Updates › WoWDeck's ⋯), after
 * Valve's Steam Client Update Channel: one row per channel, the active one
 * checked. A picks and closes at once, with no confirm step; B closes
 * without changing anything. The panel is unmounted while this is open
 * (G4): the choice goes through `onPick`. A test build is on no channel
 * (`current` null): no row is checked, and picking either — even the one
 * stored — switches, because that pick is its way out of the test build.
 * On a PR channel (GLOSSARY: PR channel) `pr` is its row, checked, above
 * Stable and Beta; A on it only closes, and picking Stable or Beta leaves
 * the PR channel. The PR's row is never shown otherwise.
 * Below the channels, "PR builds…" is no channel: it closes the picker and
 * `onPrBuilds` opens the PR builds modal (GLOSSARY: PR build).
 * While Beta is checked, a last row toggles Move to Stable after release
 * (GLOSSARY: Update channel) without closing the picker; `onMoveToStable`
 * saves it.
 */
export function UpdateChannelModal({
  current,
  pr,
  onPick,
  onPrBuilds,
  moveToStable,
  onMoveToStable,
  closeModal,
}: {
  current: UpdateChannel | null;
  /** The PR channel's row while the owner is on it; its description is the PR title, as plain text. */
  pr: { name: string; description: string } | null;
  onPick: (channel: UpdateChannel) => void;
  onPrBuilds: () => void;
  moveToStable: boolean;
  onMoveToStable: (on: boolean) => void;
  closeModal?: () => void;
}) {
  // A modal is no subscriber of the settings store: it shows its own flip.
  const [moveOn, setMoveOn] = useState(moveToStable);
  const pick = (channel: UpdateChannel) => {
    closeModal?.();
    if (channel !== current) {
      onPick(channel);
    }
  };
  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>{TITLE}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <DialogControlsSection>
          {pr && (
            <Field
              focusable
              label={pr.name}
              description={<span style={descriptionStyle}>{pr.description}</span>}
              onClick={() => closeModal?.()}
              onOKActionDescription="Select"
            >
              <RowGlyph>
                <FaCheck style={{ width: "16px", color: STEAM.positive }} />
              </RowGlyph>
            </Field>
          )}
          {UPDATE_CHANNEL_ROWS.map((row) => (
            <Field
              key={row.channel}
              focusable
              label={row.name}
              description={<span style={descriptionStyle}>{row.description}</span>}
              onClick={() => pick(row.channel)}
              onOKActionDescription="Select"
            >
              {row.channel === current && (
                <RowGlyph>
                  <FaCheck style={{ width: "16px", color: STEAM.positive }} />
                </RowGlyph>
              )}
            </Field>
          ))}
          <Field
            focusable
            label="PR builds…"
            description={
              <span style={descriptionStyle}>
                Builds of open pull requests, for testing changes before they are released.
              </span>
            }
            onClick={() => {
              closeModal?.();
              onPrBuilds();
            }}
            onOKActionDescription="Open"
          />
          {current === "beta" && (
            <ToggleField
              label="Move to Stable after release"
              description={
                <span style={descriptionStyle}>
                  Installing a stable update from here selects Stable, so later betas aren't
                  offered.
                </span>
              }
              checked={moveOn}
              onChange={(on) => {
                setMoveOn(on);
                onMoveToStable(on);
              }}
            />
          )}
        </DialogControlsSection>
      </DialogBody>
    </ModalRoot>
  );
}

export function openUpdateChannelModal(
  current: UpdateChannel | null,
  pr: { name: string; description: string } | null,
  onPick: (channel: UpdateChannel) => void,
  onPrBuilds: () => void,
  moveToStable: boolean,
  onMoveToStable: (on: boolean) => void,
): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <UpdateChannelModal
      current={current}
      pr={pr}
      onPick={onPick}
      onPrBuilds={onPrBuilds}
      moveToStable={moveToStable}
      onMoveToStable={onMoveToStable}
      closeModal={close}
    />,
    window,
    { strTitle: TITLE, bHideMainWindowForPopouts: false },
  );
}
