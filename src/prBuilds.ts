/**
 * The PR builds list's wording (GLOSSARY: PR build), apart from the modal
 * that shows it. Every text here comes from the engine's list, which comes
 * from untrusted CI data: it is returned as strings and rendered as React
 * text nodes only, never as HTML or Markdown.
 */
import type { Rpc } from "./services/envelope";
import type { PrBuild } from "./types";

/** The device's own date and time, the way Steam shows them. */
export const DEVICE_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** One row of the PR builds modal: the PR as its label, the build as its description. */
export function prBuildRow(
  build: PrBuild,
  dateFormat: Intl.DateTimeFormat = DEVICE_DATE_FORMAT,
): { label: string; description: string } {
  return {
    label: `#${build.number} ${build.title}`,
    description: `${build.author} · ${build.version} · built ${dateFormat.format(new Date(build.builtAt))}`,
  };
}

/**
 * The published PR builds, or null when they couldn't be loaded: the
 * engine's own "couldn't load" (null builds) and a failed call alike, so
 * the modal shows one error with a retry.
 */
export async function loadPrBuilds(rpc: Rpc): Promise<PrBuild[] | null> {
  try {
    return (await rpc("system.listPrBuilds")).builds;
  } catch {
    return null;
  }
}

/**
 * What the owner confirms before every PR build install: which build, and
 * that its code comes from a labeled, unreleased pull request. Decky's own
 * prompt follows.
 */
export function prBuildConfirmation(build: PrBuild): { title: string; lines: string[] } {
  return {
    title: `Install WoWDeck ${build.version}?`,
    lines: [
      `#${build.number} ${build.title}, by ${build.author}`,
      "Its code comes from a labeled, unreleased pull request. A maintainer labeled it for testing; it is not a release.",
      "To leave it later, pick Stable or Beta in the channel picker. Decky asks you to confirm the install next.",
    ],
  };
}
