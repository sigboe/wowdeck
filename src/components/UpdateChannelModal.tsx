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
 * (G4): the choice goes through `onPick`.
 */
function UpdateChannelModal({
  current,
  onPick,
  closeModal,
}: {
  current: UpdateChannel;
  onPick: (channel: UpdateChannel) => void;
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
        </DialogControlsSection>
      </DialogBody>
    </ModalRoot>
  );
}

export function openUpdateChannelModal(
  current: UpdateChannel,
  onPick: (channel: UpdateChannel) => void,
): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <UpdateChannelModal current={current} onPick={onPick} closeModal={close} />,
    window,
    { strTitle: TITLE, bHideMainWindowForPopouts: false },
  );
}
