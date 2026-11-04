import { useSyncExternalStore } from "react";
import { DropdownItem, type DropdownItemProps } from "@decky/ui";
import { installationSwitchBlocked, type AddonSession } from "../addonSession";
import { descriptionStyle } from "../steamTheme";

type Props = Omit<DropdownItemProps, "rgOptions" | "selectedOption" | "onChange" | "disabled"> & {
  session: Pick<AddonSession, "get" | "subscribe" | "selectInstallation">;
};

/**
 * The active-installation dropdown My Addons, Get Addons and Options share.
 * It reads the installations and when switching is blocked from the addon
 * session, so all three are off together and say why. A pick from a menu
 * opened before that goes to the session, which refuses it.
 */
export function InstallationSelect({ session, description, ...dropdown }: Props) {
  const state = useSyncExternalStore(session.subscribe, session.get, session.get);
  const blocked = installationSwitchBlocked(state);
  return (
    <DropdownItem
      {...dropdown}
      rgOptions={state.installations.map((i) => ({ data: i.id, label: i.displayName }))}
      selectedOption={state.selectedId}
      onChange={(option) => void session.selectInstallation(option.data as string)}
      disabled={!!blocked}
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
