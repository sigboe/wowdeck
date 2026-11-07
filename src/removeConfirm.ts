/** Wording for the Remove confirmation (pure so it can be unit-tested). */
export interface RemoveConfirmationText {
  title: string;
  description: string;
  /** The OK button, which has focus when the dialog opens: removes the addon alone. */
  okText: string;
  /** Present when the removal leaves libraries unneeded: removes the addon and them (ADR 0008). */
  withLibrariesText?: string;
}

/**
 * `leavesUnneeded`: the libraries this removal would leave unneeded
 * (`Addon.leavesUnneeded`). Named in full; the user picks whether they go
 * too, and keeping them is the default.
 */
export function removeConfirmation(
  name: string,
  managed: boolean,
  leavesUnneeded: readonly string[] = [],
): RemoveConfirmationText {
  if (!managed) {
    return {
      title: "Delete unmanaged addon folder?",
      description: `The ${name} folder will be deleted. WoWDeck Addon Manager didn't install it, so it can't be reinstalled from here.`,
      okText: "Delete",
    };
  }
  const deleted = `${name} and its folders will be deleted from your AddOns folder.`;
  if (leavesUnneeded.length === 0) {
    return {
      title: "Remove addon?",
      description: `${deleted} You can install it again later.`,
      okText: "Remove",
    };
  }
  const them = leavesUnneeded.length === 1 ? "it" : "them";
  return {
    title: "Remove addon?",
    description: `${deleted} Nothing else needs ${listed(leavesUnneeded)}: remove ${them} too, or keep ${them} installed. You can install ${name} again later.`,
    okText: `Remove ${name} only`,
    withLibrariesText: leavesUnneeded.length === 1 ? "Remove both" : "Remove all",
  };
}

/** "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
  return names.length === 1
    ? names[0]!
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Wording for removing a WoW installation record (no files are touched). */
export function removeInstallationConfirmation(name: string): {
  title: string;
  description: string;
  okText: string;
} {
  return {
    title: "Remove installation?",
    description: `WoWDeck Addon Manager will stop managing ${name}. Your game and addon files won't be deleted. To add it back, select Find WoW installations.`,
    okText: "Remove",
  };
}
