import { describe, expect, test } from "bun:test";
import {
  deleteConfirmation,
  errorCodeOf,
  friendlyWtfCallError,
  friendlyWtfError,
  wtfCompletedToast,
  jobPercent,
  jobProgressText,
  keepCurrentConfigFor,
  restoreDialogText,
} from "./wtfText";
import { backupKindLabel, backupOrigin, formatBytes, formatWhen } from "./wtfFormat";
import type { WtfJobSnapshot } from "./types";

const CODES = [
  "wtf_missing",
  "wtf_too_large",
  "backup_dir_unavailable",
  "backup_dir_invalid",
  "insufficient_space",
  "game_running",
  "job_in_progress",
  "backup_invalid",
  "flavor_mismatch",
  "flavor_unknown_needs_confirm",
  "verify_failed",
  "too_late_to_cancel",
  "cancelled",
  "not_found",
  "internal_error",
];

describe("friendlyWtfError", () => {
  test("every engine code has plain-language text that is never a Python/exception string", () => {
    for (const code of CODES) {
      const text = friendlyWtfError(code, "Traceback: boom");
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/Python|Traceback|Exception|undefined/);
    }
  });
  test("unknown code falls back to the sanitized engine message", () => {
    expect(friendlyWtfError("weird", "main.BackendError: disk exploded")).toBe("disk exploded");
    expect(friendlyWtfError(undefined, undefined)).toBe("Something went wrong.");
  });
  test("reads the code off a rejected backend call", () => {
    const e = Object.assign(new Error("x"), { code: "game_running" });
    expect(errorCodeOf(e)).toBe("game_running");
    expect(friendlyWtfCallError(e)).toContain("Close World of Warcraft");
    expect(errorCodeOf(new Error("plain"))).toBeUndefined();
  });
});

describe("job progress text", () => {
  const job = (over: Partial<WtfJobSnapshot>): WtfJobSnapshot => ({
    jobId: "j",
    kind: "create",
    installationId: "i",
    phase: "compress",
    done: 0,
    total: null,
    ...over,
  });
  test("percent is clamped and null without a total", () => {
    expect(jobPercent({ done: 50, total: 200 })).toBe(25);
    expect(jobPercent({ done: 500, total: 200 })).toBe(100);
    expect(jobPercent({ done: 5, total: null })).toBeNull();
    expect(jobPercent({ done: 5, total: 0 })).toBeNull();
  });
  test("phase wording", () => {
    expect(jobProgressText(job({ done: 63, total: 100 }))).toBe("Backing up… 63%");
    expect(jobProgressText(job({ phase: "snapshot", done: 1, total: 4 }))).toBe(
      "Saving a safety backup first… 25%",
    );
    expect(jobProgressText(job({ phase: "extract", kind: "restore", done: 1, total: 2 }))).toBe(
      "Restoring… 50%",
    );
    expect(jobProgressText(job({ phase: "swap" }))).toBe("Switching over…");
    expect(jobProgressText(job({ phase: "scan" }))).toBe("Looking at your settings…");
  });
});

describe("restore dialog", () => {
  const now = Date.UTC(2026, 9, 14, 12);
  const own = {
    createdAt: now - 3 * 24 * 3600_000,
    flavor: "_retail_",
    hasConfig: true,
    fromThisDevice: true,
    keepConfigSuggested: false,
  };

  test("own backup: green origin, safety backup + WoW closed, toggle OFF by default (owner, 2026-10-17)", () => {
    const d = restoreDialogText(own, "Retail", "not_running", now);
    expect(d).toMatchObject({ okText: "Restore", acceptUnknownFlavor: false });
    expect(d.origin).toEqual({ text: "From this device", good: true });
    expect(d.paragraphs.join(" ")).toContain("safety backup");
    expect(d.paragraphs.join(" ")).toContain("3 days ago");
    expect(d.paragraphs.join(" ")).toContain("must be closed");
    expect(d.config).toMatchObject({ defaultOn: false, disabled: false });
  });

  test("backup from another computer: red origin, no version warning, toggle ON", () => {
    const d = restoreDialogText(
      { ...own, fromThisDevice: false, keepConfigSuggested: true },
      "Retail",
      "not_running",
      now,
    );
    expect(d.origin).toEqual({ text: "From another computer", good: false });
    expect(d.paragraphs.join(" ")).not.toContain("doesn't say which WoW version");
    expect(d.acceptUnknownFlavor).toBe(false);
    expect(d.config.defaultOn).toBe(true);
  });

  test("desktop WowUp backup: red origin, asks for the version confirmation, toggle ON", () => {
    const d = restoreDialogText(
      { ...own, flavor: null, fromThisDevice: false, keepConfigSuggested: true },
      "Retail",
      "unknown",
      now,
    );
    expect(d.origin).toEqual({ text: "From another computer (WowUp)", good: false });
    expect(d.paragraphs.join(" ")).toContain("doesn't say which WoW version");
    expect(d.paragraphs.join(" ")).toContain("Make sure World of Warcraft is closed");
    expect(d.acceptUnknownFlavor).toBe(true);
    expect(d.config.defaultOn).toBe(true);
  });

  test("a backup without a Config.wtf: toggle is off and disabled, with an explanation", () => {
    const d = restoreDialogText({ ...own, hasConfig: false }, "Retail", "not_running", now);
    expect(d.config).toMatchObject({ defaultOn: false, disabled: true });
    expect(d.config.help).toContain("no graphics settings");
  });

  test("keepCurrentConfigFor never sends true for a backup without a Config.wtf", () => {
    expect(keepCurrentConfigFor({ hasConfig: true }, true)).toBe(true);
    expect(keepCurrentConfigFor({ hasConfig: true }, false)).toBe(false);
    expect(keepCurrentConfigFor({ hasConfig: false }, true)).toBe(false);
  });
});

describe("delete confirmation", () => {
  const now = Date.UTC(2026, 9, 14, 12);
  test("wording", () => {
    expect(deleteConfirmation({ createdAt: now, kind: "pre-restore" }, now).description).toContain(
      "safety backup",
    );
    expect(deleteConfirmation({ createdAt: now, kind: "manual" }, now).okText).toBe("Delete");
  });
});

describe("formatting", () => {
  test("bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(38_000_000)).toBe("38 MB");
    expect(formatBytes(1_460_000)).toBe("1.5 MB");
    expect(formatBytes(2_000_000_000)).toBe("2 GB");
    expect(formatBytes(-1)).toBe("—");
  });
  test("relative time", () => {
    const now = Date.UTC(2026, 9, 14, 12, 0, 0);
    expect(formatWhen(now - 10_000, now)).toBe("just now");
    expect(formatWhen(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(formatWhen(now - 3 * 3600_000, now)).toBe("3 hours ago");
    expect(formatWhen(now - 30 * 3600_000, now)).toBe("yesterday");
    expect(formatWhen(now - 4 * 86400_000, now)).toBe("4 days ago");
    expect(formatWhen(now - 20 * 86400_000, now)).toBe("24 Sep");
    expect(formatWhen(now + 3_600_000, now)).toBe("14 Oct"); // clock skew: never "-1 hours ago"
  });
  test("origin: green for this device, red for another computer or WowUp, none for a damaged backup", () => {
    expect(backupOrigin({ fromThisDevice: true, flavor: "_retail_", valid: true })).toEqual({
      text: "From this device",
      good: true,
    });
    expect(backupOrigin({ fromThisDevice: false, flavor: "_retail_", valid: true })).toEqual({
      text: "From another computer",
      good: false,
    });
    expect(backupOrigin({ fromThisDevice: false, flavor: null, valid: true })).toEqual({
      text: "From another computer (WowUp)",
      good: false,
    });
    expect(backupOrigin({ fromThisDevice: false, flavor: null, valid: false })).toBeNull();
  });
  test("kind labels", () => {
    expect(backupKindLabel({ kind: "manual", flavor: "_retail_", valid: true })).toBe("Manual");
    expect(backupKindLabel({ kind: "manual", flavor: null, valid: true })).toBe("From WowUp");
    expect(backupKindLabel({ kind: "pre-restore", flavor: "_retail_", valid: true })).toBe(
      "Safety backup",
    );
    expect(backupKindLabel({ kind: "auto", flavor: "_retail_", valid: true })).toBe("Automatic");
    expect(backupKindLabel({ kind: "unknown", flavor: null, valid: false })).toBe("Damaged");
  });
});

describe("wtfCompletedToast", () => {
  const done = {
    jobId: "j",
    installationId: "i",
    fileName: "wtf_1.zip",
    snapshotFileName: null,
    error: null,
  };
  test("says what happened", () => {
    expect(wtfCompletedToast({ ...done, kind: "create" })).toEqual({
      title: "Backup created",
      body: "",
    });
    expect(wtfCompletedToast({ ...done, kind: "restore", snapshotFileName: "wtf_0.zip" })).toEqual({
      title: "Settings restored",
      body: "Your previous settings were saved as a safety backup.",
    });
  });
  test("a failure gets plain text; a cancel gets nothing", () => {
    expect(
      wtfCompletedToast({
        ...done,
        kind: "create",
        error: { code: "insufficient_space", message: "x" },
      }),
    ).toEqual({ title: "Couldn't back up settings", body: "Not enough free space." });
    expect(
      wtfCompletedToast({ ...done, kind: "restore", error: { code: "cancelled", message: "x" } }),
    ).toBeNull();
  });
});
