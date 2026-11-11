import {
  DialogBody,
  DialogControlsSection,
  DialogHeader,
  Field,
  ModalRoot,
  showModal,
} from "@decky/ui";
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
 * Below the channels, "PR builds…" is no channel: it closes the picker and
 * `onPrBuilds` opens the PR builds modal (GLOSSARY: PR build).
 */
export function UpdateChannelModal({
  current,
  onPick,
  onPrBuilds,
  closeModal,
}: {
  current: UpdateChannel | null;
  onPick: (channel: UpdateChannel) => void;
  onPrBuilds: () => void;
  closeModal?: () => void;
}) {
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
                <FaCheck style={{ width: "16px", color: STEAM.positive }} />
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
        </DialogControlsSection>
      </DialogBody>
    </ModalRoot>
  );
}

export function openUpdateChannelModal(
  current: UpdateChannel | null,
  onPick: (channel: UpdateChannel) => void,
  onPrBuilds: () => void,
): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <UpdateChannelModal
      current={current}
      onPick={onPick}
      onPrBuilds={onPrBuilds}
      closeModal={close}
    />,
    window,
    { strTitle: TITLE, bHideMainWindowForPopouts: false },
  );
}
