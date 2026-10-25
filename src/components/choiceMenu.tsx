import { Menu, MenuItem, showContextMenu } from "@decky/ui";

/**
 * A Steam context menu of choices with the current one marked (dropdown
 * menus on Y or Menu, the release channel menus). `current` undefined marks
 * none (a menu of actions rather than a setting).
 */
export function showChoiceMenu<T>(
  label: string,
  choices: { value: T; label: string }[],
  current: T | undefined,
  onPick: (value: T) => void,
  anchor?: EventTarget | null,
): void {
  showContextMenu(
    <Menu label={label}>
      {choices.map((c) => (
        <MenuItem
          key={String(c.value)}
          selected={current !== undefined && c.value === current}
          onClick={() => onPick(c.value)}
        >
          {c.label}
        </MenuItem>
      ))}
    </Menu>,
    anchor ?? window,
  );
}
