/**
 * Closes Steam's on-screen keyboard after a text field's action runs.
 *
 * Depends on: `window.SteamUIStore.ActiveWindowInstance.VirtualKeyboardManager`
 * with `SetVirtualKeyboardHidden()` and `IsShowingVirtualKeyboard.Value`
 * (DEVICE 2026-11-14: with the keyboard up over Get Addons' Search field,
 * the call closed it, input went back to the QAM and the field kept focus).
 * Steam's own keyboard closes itself on Enter only for game text input; a
 * Steam UI text field leaves it open after Enter.
 * Fails as: a Steam change leaves the keyboard open after the action, as it
 * was before this helper. Nothing throws.
 * Kill switch: none needed; drop the calls in the submit handlers.
 */

interface KeyboardManager {
  SetVirtualKeyboardHidden?: () => void;
  IsShowingVirtualKeyboard?: { Value?: unknown } | null;
}

interface KeyboardReach {
  ActiveWindowInstance?: { VirtualKeyboardManager?: KeyboardManager | null } | null;
}

/** Closes the on-screen keyboard if it is open. Safe to call when it isn't. */
export function hideOnScreenKeyboard(): void {
  try {
    const store = (window as { SteamUIStore?: KeyboardReach | null }).SteamUIStore;
    const keyboard = store?.ActiveWindowInstance?.VirtualKeyboardManager;
    if (keyboard?.IsShowingVirtualKeyboard?.Value === false) {
      return;
    }
    keyboard?.SetVirtualKeyboardHidden?.();
  } catch (err) {
    console.warn("wowdeck: can't close the on-screen keyboard", err);
  }
}
