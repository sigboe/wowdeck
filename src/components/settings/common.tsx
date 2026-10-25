import type { CSSProperties, ReactNode } from "react";
import { Spinner } from "@decky/ui";
import { FaChevronRight } from "react-icons/fa";
import { FocusRow } from "../FocusSlot";
import { QAM_VIEW } from "../../qamState";

export const VIEW = QAM_VIEW.settings;

/**
 * The CurseForge section's key row. Also the Options jump's fallback
 * landing while CurseForge has no usable key: its sources toggle is
 * disabled in that state (optionsJump.ts), and the row that sets the key
 * up is the one place focus helps (its own sources row says "see
 * CurseForge above").
 */
export const CURSE_KEY_ROW = "curseKey";

/**
 * DEVICE (2026-10-13): on SteamOS 3.8.28 `bIsPassword` alone left the
 * rendered <input> as type="text" (it is forwarded to the DOM element but
 * not acted on), so also pass `type`, which reaches the <input> too.
 * @decky/ui's TextFieldProps does not declare `type`, hence the spread.
 */
export const PASSWORD_INPUT_PROPS = { type: "password" } as Record<string, unknown>;

/**
 * A settings row that keeps its place in focus memory (guide S21): the panel
 * is rebuilt after every dropdown menu, modal and file picker, and sections
 * load in at different times, so focus must come back by row, not position.
 */
export function SettingsRow({
  id,
  className,
  style,
  children,
}: {
  id: string;
  /** Extra classes on the row wrapper (the Options jump's blink, optionsJump.ts). */
  className?: string;
  /** The wrapper's inline style (the blink's shared phase). */
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <FocusRow view={VIEW} id={id} className={className} style={style}>
      {children}
    </FocusRow>
  );
}

export const busyIcon = (busy: boolean, idle: ReactNode = <FaChevronRight />) =>
  busy ? <Spinner style={{ width: "1.2em" }} /> : idle;
