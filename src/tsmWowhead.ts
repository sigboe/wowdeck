/**
 * Links from the Ledger's items to Wowhead. The engine names the
 * installation's Wowhead section (TradeSkillMasterLedger.wowhead); an item
 * links by its item ID alone, so a Retail item with bonus IDs opens at its
 * base item level (owner, PR #318 review: Wowhead's `?bonus=` is not
 * confirmed to change the page).
 */

/** The item ID of a TradeSkillMaster item string (`i:12345`, `i:12345::…`); null for anything else, a battle pet (`p:…`) included. */
export function ledgerItemId(itemString: string): number | null {
  const match = /^i:(\d+)/.exec(itemString);
  return match ? Number(match[1]) : null;
}

/** The item's Wowhead page in the installation's section, or null when either is unknown. */
export function wowheadItemUrl(section: string | null, itemString: string): string | null {
  const id = ledgerItemId(itemString);
  if (section === null || id === null) {
    return null;
  }
  return `https://www.wowhead.com/${section === "" ? "" : `${section}/`}item=${id}`;
}

/**
 * An item's name for the list: the cached name, or "Item 12345" when the
 * addon cached none and the engine fell back to the raw item string.
 */
export function ledgerItemLabel(name: string, itemString: string): string {
  const id = ledgerItemId(itemString);
  return id !== null && (name === itemString || name.startsWith("i:")) ? `Item ${id}` : name;
}
