/**
 * Addon source ids and the names people know them by (C05). One table for
 * the engine (messages, `ProviderInfo.name`) and the UI, which imports this
 * module: pure data, no I/O.
 */

import type { AddonProviderType } from "../wow/types";

/** The provider ids in use; providers, engine code and UI refer to these, never to string literals. */
export const PROVIDER_ID = {
  Curse: "Curse",
  File: "File",
  GitHub: "GitHub",
  TukUI: "TukUI",
  WowInterface: "WowInterface",
  WowUpHub: "WowUpHub",
  Zip: "Zip",
} as const satisfies Record<string, AddonProviderType>;

const DISPLAY_NAMES: Record<string, string> = {
  [PROVIDER_ID.Curse]: "CurseForge",
  [PROVIDER_ID.File]: "Local file",
  [PROVIDER_ID.GitHub]: "GitHub",
  [PROVIDER_ID.TukUI]: "TukUI",
  [PROVIDER_ID.WowInterface]: "WoWInterface",
  [PROVIDER_ID.WowUpHub]: "WowUp Hub",
  [PROVIDER_ID.Zip]: "Direct link",
};

/** A provider's name as people know it; an unknown id is shown as is. */
export function providerDisplayName(id: string): string {
  // Own keys only: ids can come from untrusted import codes ("constructor").
  return Object.prototype.hasOwnProperty.call(DISPLAY_NAMES, id) ? DISPLAY_NAMES[id]! : id;
}
