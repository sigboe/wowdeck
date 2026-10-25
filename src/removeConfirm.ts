/** Wording for the Remove confirmation (pure so it can be unit-tested). */
export function removeConfirmation(
  name: string,
  managed: boolean,
  alsoRemoves: string[] = [],
): { title: string; description: string; okText: string } {
  const along = alsoRemoves.length
    ? ` Also removes ${alsoRemoves.join(", ")}, which nothing else needs.`
    : "";
  return {
    title: managed ? "Remove addon?" : "Delete unmanaged addon folder?",
    description: managed
      ? `${name} and its folders will be deleted from your AddOns folder.${along} You can install it again later.`
      : `The ${name} folder will be deleted. WoWDeck Addon Manager didn't install it, so it can't be reinstalled from here.`,
    okText: managed ? "Remove" : "Delete",
  };
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
