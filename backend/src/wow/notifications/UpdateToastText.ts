/**
 * The words of the SteamOS "updates available" toast (UpdateToastGate).
 * Built here so the frontend shows what arrives, like WoWDeck's own update
 * toast (ADR-0004). The frontend's `plural` (src/text.ts) and `formatList`
 * (src/search.ts) are mirrored below: neither side imports the other.
 */

export interface UpdateToast {
  title: string;
  body: string;
}

/** An installation with eligible updates, in installation-list order. */
export interface InstallationUpdates {
  displayName: string;
  updates: number;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "A", "A and B", "A, B and C". */
function formatList(items: string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * "3 addon updates available" / "In Retail and Classic Era". With one
 * installation the body points at the plugin instead of naming it.
 * Installations without updates are not named. Null when nothing waits.
 */
export function updateToastText(installations: InstallationUpdates[]): UpdateToast | null {
  const withUpdates = installations.filter((installation) => installation.updates > 0);
  const updateCount = withUpdates.reduce((sum, installation) => sum + installation.updates, 0);
  if (updateCount === 0) {
    return null;
  }
  const body =
    withUpdates.length > 1
      ? `In ${formatList(withUpdates.map((installation) => installation.displayName))}`
      : "Open WoWDeck Manager to update";
  return { title: `${plural(updateCount, "addon update")} available`, body };
}
