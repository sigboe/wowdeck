/**
 * Recovery copy (ADR 0006, #107): the notice a recovery-required
 * installation shows in all three tabs, and the rows of the shared
 * recovery-details view. The engine pre-digests the details
 * (`installations.recoveryDetails`); this only words them.
 */

import type {
  Installation,
  InstallationRecoveryDetails,
  RecoveryOperationDetails,
  RecoveryRetryResult,
  RecoveryVerifyResult,
} from "./types";
import { dayAndTime } from "./text";

/**
 * Recovery text as C03 wants it (UI_DEVELOPMENT_BEST_PRACTICES): one
 * sentence has no period, several each end with one. Parts may already
 * end with a period, or hold more than one sentence; empty parts drop out.
 */
export function sentences(...parts: (string | null | undefined)[]): string {
  const texts = parts
    .map((p) => (p ?? "").trim().replace(/\.$/, ""))
    .filter((p) => p !== "")
    .map((p, i, all) => (i < all.length - 1 && !/[.!?]$/.test(p) ? `${p}.` : p));
  const text = texts.join(" ");
  return /[.!?] /.test(text) && !/[.!?]$/.test(text) ? `${text}.` : text;
}

/** The installation-level notice: names the installation, says changes are paused. */
export function recoveryNotice(installation: Pick<Installation, "displayName">): {
  label: string;
  description: string;
} {
  return {
    label: `${installation.displayName} needs recovery`,
    description: sentences(
      "An addon change couldn't put its files back",
      "Addon changes are paused in this installation, and its addon information is unverified",
    ),
  };
}

/**
 * The notice while the engine can't read its saved state file: it names no
 * installation (none is listed then) and says what stays unsaved.
 */
export function stateFileNotice(): { label: string; description: string } {
  return {
    label: "Saved addon information can't be read",
    description: sentences(
      "Addon changes are paused in every installation",
      "Settings changes aren't saved until it's repaired",
    ),
  };
}

const OPERATION_LABEL: Record<RecoveryOperationDetails["operation"], string> = {
  install: "Install",
  update: "Update",
  remove: "Removal",
  rollback: "Roll back",
  unknown: "Addon change",
};

export interface RecoveryRow {
  kind: "preserved" | "conflict" | "note";
  label: string;
  description: string;
}

/** One stopped operation as the details view shows it. */
export function recoveryOperationView(
  op: RecoveryOperationDetails,
  now: number,
): { title: string; summary: string; rows: RecoveryRow[] } {
  const summary = [
    `${OPERATION_LABEL[op.operation]} stopped`,
    op.startedAt !== null ? `started ${dayAndTime(op.startedAt, now)}` : "",
    op.originalVersion ? `was version ${op.originalVersion}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const rows: RecoveryRow[] = [
    ...op.preserved.map((p) => ({
      kind: "preserved" as const,
      label: p.location,
      description: sentences("Recovery copy of the original files", `It belongs at ${p.belongsAt}`),
    })),
    ...op.conflicts.map((c) => ({
      kind: "conflict" as const,
      label: c.location,
      description: c.reason,
    })),
  ];
  if (op.preserved.length === 0 && op.conflicts.length === 0) {
    rows.push({
      kind: "note",
      label: "No recovery copies found",
      description: "This addon change made no recovery copies, or they're back in place",
    });
  }
  return { title: op.addonName, summary, rows };
}

/** The toast after Retry recovery put an installation's files back. */
export function retryRecoveredToast(
  installationName: string,
  result: Extract<RecoveryRetryResult, { status: "recovered" }>,
): { title: string; body: string } {
  return {
    title: `Recovered ${installationName}`,
    body: sentences(
      result.restored.length ? `${result.restored.join(", ")} put back` : null,
      "Addon changes work again",
      result.cleanupWarning,
    ),
  };
}

/**
 * Retry recovery's answer as the details view shows it, above the
 * operations: why it stopped and what to do next, then each conflict.
 */
export function retryOutcomeView(result: RecoveryRetryResult): {
  label: string;
  description: string;
  rows: RecoveryRow[];
} {
  if (result.status === "recovered") {
    return {
      label: "Recovery finished",
      description: result.cleanupWarning ?? "The original files and addon information are back",
      rows: [],
    };
  }
  return {
    label: "Retry recovery stopped",
    description: sentences(
      result.restored.length ? `${result.restored.join(", ")} put back` : null,
      result.reason,
      result.nextStep,
      "Nothing was overwritten or deleted",
    ),
    rows: result.conflicts.map((c) => ({
      kind: "conflict" as const,
      label: c.location,
      description: c.reason,
    })),
  };
}

/** The toast after Verify recovery confirmed a manual repair. */
export function verifiedToast(
  installationName: string,
  result: Extract<RecoveryVerifyResult, { status: "verified" }>,
): { title: string; body: string } {
  return {
    title: `Verified the repair of ${installationName}`,
    body: sentences(
      result.verified.length ? `${result.verified.join(", ")} checked` : null,
      "Addon changes work again",
      result.cleanupWarning,
    ),
  };
}

/**
 * A recovery action's answer as the details view shows it, above the
 * operations: Retry recovery's (retryOutcomeView) or Verify recovery's,
 * which lists what still differs from the original when it refused.
 */
export function recoveryOutcomeView(result: RecoveryRetryResult | RecoveryVerifyResult): {
  label: string;
  description: string;
  rows: RecoveryRow[];
} {
  if (!("verified" in result)) {
    return retryOutcomeView(result);
  }
  if (result.status === "verified") {
    return {
      label: "Recovery verified",
      description: result.cleanupWarning ?? "The original files and addon information are back",
      rows: [],
    };
  }
  return {
    label: "Verify recovery found differences",
    description: sentences(
      result.verified.length ? `${result.verified.join(", ")} checked` : null,
      result.reason,
      result.nextStep,
      "Nothing was changed",
    ),
    rows: result.conflicts.map((c) => ({
      kind: "conflict" as const,
      label: c.location,
      description: c.reason,
    })),
  };
}

/**
 * The recovery actions the engine can't offer, and why, as one line:
 * Retry recovery and Verify recovery share their reason when both are off.
 */
export function unavailableActionsView(
  details: Pick<InstallationRecoveryDetails, "retry" | "verify">,
): { label: string; description: string }[] {
  const off = (
    [
      ["Retry recovery", details.retry],
      ["Verify recovery", details.verify],
    ] as const
  ).flatMap(([name, a]) => (a.available ? [] : [{ name, reason: a.reason, nextStep: a.nextStep }]));
  const [first, second] = off;
  if (first && second && first.reason === second.reason && first.nextStep === second.nextStep) {
    return [
      {
        label: `${first.name} and ${second.name} aren't available`,
        description: sentences(first.reason, first.nextStep),
      },
    ];
  }
  return off.map((o) => ({
    label: `${o.name} isn't available`,
    description: sentences(o.reason, o.nextStep),
  }));
}
