/**
 * Where every file picker starts: the folder the player already chose or
 * typed, else the home folder of the user Decky runs Steam for (the engine's
 * HOME, from `system.getStatus`), else `/`. Never a guessed Steam Deck user folder:
 * it doesn't exist when the Steam user has another name (#133).
 */

let engineHome: string | null = null;

/** Called with `system.getStatus`'s `homeDir` when the panel first reaches the engine. */
export function rememberEngineHome(homeDir: string | null | undefined): void {
  if (homeDir) {
    engineHome = homeDir;
  }
}

/** The start-folder rule, pure: `preferred` wins, then `home`, then `/`. */
export function chooseStartPath(preferred: string | null | undefined, home: string | null): string {
  return preferred?.trim() || home || "/";
}

/** The start path for an `openFilePicker` call, given the folder the picker prefers, if any. */
export function pickerStartPath(preferred?: string | null): string {
  return chooseStartPath(preferred, engineHome);
}
