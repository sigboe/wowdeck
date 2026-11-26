import { FaEyeSlash } from "react-icons/fa";
import { toastError } from "../toast";
import { useRef, useState, useSyncExternalStore } from "react";
import { DropdownItem, type DropdownItemProps } from "@decky/ui";
import { installationSwitchBlocked, type AddonSession } from "../addonSession";
import { descriptionStyle } from "../steamTheme";

type Props = Omit<DropdownItemProps, "rgOptions" | "selectedOption" | "onChange" | "disabled"> & {
  showHidden?: boolean;
  session: Pick<AddonSession, "get" | "subscribe" | "selectInstallation" | "updateInstallation">;
};

/** The Unhide entry's value: never an installation id, which is 12 hex digits. */
const UNHIDE = "wowdeck:unhide";

/**
 * The active-installation dropdown My Addons, Get Addons and Options share.
 * It reads the installations and when switching is blocked from the addon
 * session, so all three are off together and say why. A pick from a menu
 * opened before that goes to the session, which refuses it.
 */
export function InstallationSelect({
  session,
  description,
  showHidden = false,
  ...dropdown
}: Props) {
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const state = useSyncExternalStore(session.subscribe, session.get, session.get);
  const blocked = installationSwitchBlocked(state);
  const selected = state.installations.find((i) => i.id === state.selectedId);
  // A hidden active installation still shows its list here, with Unhide
  // last (#338): a menu holding only Unhide left no way to switch.
  const offerUnhide = selected?.hidden === true && !showHidden;
  const unhide = () => {
    if (!selected || pending.current) return;
    pending.current = true;
    setSaving(true);
    void session
      .updateInstallation(selected.id, { hidden: false })
      .catch((e) => toastError("Couldn't unhide installation", e))
      .finally(() => {
        pending.current = false;
        setSaving(false);
      });
  };
  return (
    <DropdownItem
      {...dropdown}
      rgOptions={[
        ...state.installations
          .filter((i) => showHidden || !i.hidden || i.id === state.selectedId)
          .map((i) => ({
            data: i.id,
            label: i.hidden ? (
              <>
                {i.displayName} <FaEyeSlash title="Hidden installation" />
              </>
            ) : (
              i.displayName
            ),
          })),
        ...(offerUnhide ? [{ data: UNHIDE, label: `Unhide ${selected.displayName}` }] : []),
      ]}
      selectedOption={state.selectedId}
      onChange={(option) =>
        option.data === UNHIDE ? unhide() : void session.selectInstallation(option.data as string)
      }
      disabled={saving || !!blocked}
      description={
        blocked ? (
          <>
            {description}
            <div style={descriptionStyle}>{blocked}</div>
          </>
        ) : (
          description
        )
      }
    />
  );
}
