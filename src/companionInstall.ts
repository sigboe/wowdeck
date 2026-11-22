import type { AddonSession } from "./addonSession";
import type { Rpc } from "./services/envelope";
import type { Diagnostics, OperationResult } from "./types";

/**
 * WowUp Companion (the in-game addon showing WoWDeck's update data) comes
 * from WowUp Hub by its fixed id, never by search, so a lookalike can't be
 * installed: Hub addon 27 is github.com/WowUp/WowUp.Addon (spec #183).
 */
export const COMPANION_PROVIDER_ID = "WowUpHub";
export const COMPANION_EXTERNAL_ID = "27";

/**
 * What Options › Notifications › Updates inside WoW offers. Only the active
 * installation is ever offered an install; the others missing the companion
 * are only named (clientLabel, as Diagnostics reports them).
 */
export type CompanionStatus =
  | { kind: "missing"; installationId: string; missingElsewhere: string[] }
  | { kind: "installed"; missingElsewhere: string[] }
  | { kind: "unknown"; missingElsewhere: string[] };

export function companionStatus(
  diagnostics: Pick<Diagnostics, "installations"> | null,
  activeInstallationId: string | null,
): CompanionStatus {
  const installations = diagnostics?.installations ?? [];
  const active = installations.find((i) => i.id === activeInstallationId);
  const missingElsewhere = installations
    .filter((i) => i !== active && !i.companionAddonDetected)
    .map((i) => i.clientLabel);
  if (!active) {
    return { kind: "unknown", missingElsewhere };
  }
  return active.companionAddonDetected
    ? { kind: "installed", missingElsewhere }
    : { kind: "missing", installationId: active.id, missingElsewhere };
}

export interface CompanionInstallDeps {
  rpc: Rpc;
  /**
   * The addon session's entry point for installs it didn't start: it holds
   * installation switching while the install runs and reads My Addons again
   * when it settles (the companion is a managed addon there).
   */
  installElsewhere: AddonSession["installElsewhere"];
  /** Whether the WowUp Hub source is on, read when the player confirms. Never turned on here. */
  hubEnabled: () => boolean;
  /** Read the companion status again so the row stops offering the install. */
  reloadDiagnostics: () => Promise<void>;
}

export type CompanionInstallResult =
  | { status: "hubOff" }
  | { status: "installed"; operation: OperationResult }
  | { status: "failed"; error: unknown };

/** Install WowUp Companion into one installation through the normal managed install path. */
export async function installCompanion(
  deps: CompanionInstallDeps,
  installationId: string,
): Promise<CompanionInstallResult> {
  if (!deps.hubEnabled()) {
    return { status: "hubOff" };
  }
  try {
    const { operation } = await deps.installElsewhere(installationId, () =>
      deps.rpc("addons.install", {
        providerId: COMPANION_PROVIDER_ID,
        externalId: COMPANION_EXTERNAL_ID,
        installationId,
      }),
    );
    if (operation.status === "failed") {
      return { status: "failed", error: operation.error ?? "" };
    }
    await deps.reloadDiagnostics();
    return { status: "installed", operation };
  } catch (e) {
    return { status: "failed", error: e };
  }
}
