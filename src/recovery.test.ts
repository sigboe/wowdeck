/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { RecoveryOperationDetails } from "./types";
import {
  recoveryNotice,
  recoveryOperationView,
  retryOutcomeView,
  retryRecoveredToast,
  sentences,
  stateFileNotice,
  unavailableActionsView,
  verifiedToast,
} from "./recovery";

const NOW = new Date(2026, 10, 4, 15, 0).getTime();

const operation = (over: Partial<RecoveryOperationDetails> = {}): RecoveryOperationDetails => ({
  transactionId: "tx-1",
  addonName: "Suite",
  originalVersion: "1.0",
  operation: "update",
  startedAt: new Date(2026, 10, 4, 14, 32).getTime(),
  preserved: [],
  conflicts: [],
  ...over,
});

describe("recovery notice", () => {
  test("names the installation and says addon changes are paused there", () => {
    const notice = recoveryNotice({ displayName: "Retail" });
    expect(notice.label).toBe("Retail needs recovery");
    expect(notice.description).toContain("couldn't put its files back");
    expect(notice.description).toContain("paused");
    expect(notice.description.endsWith(".")).toBe(true);
  });

  test("an unreadable state file names no installation and says what isn't saved", () => {
    const notice = stateFileNotice();
    expect(notice.label).toBe("Saved addon information can't be read");
    expect(notice.description).toBe(
      "Addon changes are paused in every installation. Settings changes aren't saved until it's repaired.",
    );
  });
});

describe("recovery text punctuation (C03)", () => {
  test("one sentence has no period; several each end with one", () => {
    expect(sentences("Addon changes work again")).toBe("Addon changes work again");
    expect(sentences("Is missing.")).toBe("Is missing");
    expect(sentences("Suite put back", "Addon changes work again")).toBe(
      "Suite put back. Addon changes work again.",
    );
    expect(sentences("Isn't available. Is the SD card inserted?", "Try again")).toBe(
      "Isn't available. Is the SD card inserted? Try again.",
    );
    expect(sentences("Kept in AddOns/.wowdeck/tx-1", undefined, "")).toBe(
      "Kept in AddOns/.wowdeck/tx-1",
    );
  });

  test("a recovery toast with a cleanup warning reads as separate sentences, titled with what happened", () => {
    const cleanupWarning =
      "Its temporary files are left in AddOns/.wowdeck/tx-1. You can delete them.";
    expect(
      retryRecoveredToast("Retail", {
        installationId: "A",
        status: "recovered",
        restored: ["Suite"],
        cleanupWarning,
      }),
    ).toEqual({
      title: "Recovered Retail",
      body: "Suite put back. Addon changes work again. Its temporary files are left in AddOns/.wowdeck/tx-1. You can delete them.",
    });
    expect(
      verifiedToast("Retail", {
        installationId: "A",
        status: "verified",
        verified: [],
        cleanupWarning,
      }),
    ).toEqual({
      title: "Verified the repair of Retail",
      body: "Addon changes work again. Its temporary files are left in AddOns/.wowdeck/tx-1. You can delete them.",
    });
    expect(
      retryRecoveredToast("Retail", { installationId: "A", status: "recovered", restored: [] })
        .body,
    ).toBe("Addon changes work again");
  });

  test("refusals and unavailable actions end with a period", () => {
    const refused = retryOutcomeView({
      installationId: "A",
      status: "refused",
      restored: [],
      reason: "Files changed since the addon change stopped",
      nextStep: "Put the files listed here back as they were, then try again",
      conflicts: [],
    });
    expect(refused.description).toBe(
      "Files changed since the addon change stopped. Put the files listed here back as they were, then try again. Nothing was overwritten or deleted.",
    );
    const [line] = unavailableActionsView({
      retry: { available: false, reason: "Can't read it", nextStep: "Put the files back by hand" },
      verify: { available: true },
    });
    expect(line?.description).toBe("Can't read it. Put the files back by hand.");
  });
});

describe("recovery details", () => {
  test("an operation reads as what stopped, when, and the version it had", () => {
    const view = recoveryOperationView(operation(), NOW);
    expect(view.title).toBe("Suite");
    expect(view.summary).toBe("Update stopped · started today at 14:32 · was version 1.0");
  });

  test("a new install with no version or time says only what stopped", () => {
    const view = recoveryOperationView(
      operation({ operation: "install", originalVersion: null, startedAt: null }),
      NOW,
    );
    expect(view.summary).toBe("Install stopped");
  });

  test("preserved locations say where each copy belongs; conflicts give their reason", () => {
    const view = recoveryOperationView(
      operation({
        preserved: [{ location: "AddOns/.wowdeck/tx-1/backup/Suite", belongsAt: "AddOns/Suite" }],
        conflicts: [
          { location: "AddOns/Suite", reason: "Holds the files this addon change put here." },
        ],
      }),
      NOW,
    );
    expect(view.rows).toEqual([
      {
        kind: "preserved",
        label: "AddOns/.wowdeck/tx-1/backup/Suite",
        description: "Recovery copy of the original files. It belongs at AddOns/Suite.",
      },
      {
        kind: "conflict",
        label: "AddOns/Suite",
        description: "Holds the files this addon change put here.",
      },
    ]);
  });

  test("nothing found kept says so instead of an empty list", () => {
    const view = recoveryOperationView(operation(), NOW);
    expect(view.rows).toEqual([
      { kind: "note", label: "No recovery copies found", description: expect.any(String) },
    ]);
  });
});
