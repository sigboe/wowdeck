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
  copySourceOption,
  copySourceRows,
  copySourceStatus,
  currentSettingsBackup,
  outcomeOf,
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
    sourceName: null,
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
  test("a copy names the version the settings came from", () => {
    expect(
      wtfCompletedToast({
        ...done,
        kind: "copy",
        snapshotFileName: "wtf_0.zip",
        sourceName: "Forever Beta",
      }),
    ).toEqual({
      title: "Settings copied from Forever Beta",
      body: "Your previous settings were saved as a safety backup.",
    });
    expect(
      wtfCompletedToast({
        ...done,
        kind: "copy",
        sourceName: "Forever Beta",
        error: { code: "game_running", message: "x" },
      }),
    ).toEqual({
      title: "Couldn't copy settings",
      body: "Close World of Warcraft first. It rewrites these files when you log out.",
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

describe("Settings copy text", () => {
  const now = 1_700_000_000_000;
  const backup = {
    createdAt: now - 3 * 86_400_000,
    flavor: "_classic_beta_",
    hasConfig: true,
    fromThisDevice: true,
    keepConfigSuggested: false,
  };

  test("related version: Copy, the realms/addons line, Keep graphics on even for this device's backup", () => {
    const d = restoreDialogText(backup, "Forever", "not_running", now, {
      name: "Forever Beta",
      related: true,
    });
    expect(d.title).toBe("Copy settings?");
    expect(d.okText).toBe("Copy");
    expect(d.paragraphs[0]).toContain("Forever Beta");
    expect(d.paragraphs.join(" ")).toContain("safety backup");
    expect(d.warning).toEqual({
      text: "Characters on the old realms won't match, and addons you don't have here keep their settings unused.",
      danger: false,
    });
    expect(d.config.defaultOn).toBe(true);
  });

  test("unrelated version: red warning and Copy anyway", () => {
    const d = restoreDialogText(backup, "Classic Era", "not_running", now, {
      name: "Retail",
      related: false,
    });
    expect(d.okText).toBe("Copy anyway");
    expect(d.warning?.danger).toBe(true);
    expect(d.warning?.text).toContain("Retail");
    expect(d.warning?.text).toContain("may not work");
  });

  test("a desktop WowUp backup from another version asks no version question", () => {
    const d = restoreDialogText({ ...backup, flavor: null }, "Forever", "not_running", now, {
      name: "Forever Beta",
      related: true,
    });
    expect(d.acceptUnknownFlavor).toBe(false);
    expect(d.paragraphs.join(" ")).not.toContain("doesn't say which WoW version");
  });

  test("a plain restore has no copy warning", () => {
    expect(restoreDialogText(backup, "Forever", "not_running", now).warning).toBeNull();
  });

  test("a version that is no longer installed says so", () => {
    expect(copySourceStatus({ installed: false })).toBe("Not installed · backups only");
    expect(copySourceStatus({ installed: true })).toBeNull();
    expect(copySourceOption({ displayName: "Anniversary", installed: false })).toBe(
      "Anniversary (not installed)",
    );
    expect(copySourceOption({ displayName: "Forever Beta", installed: true })).toBe("Forever Beta");
  });

  test("the inline outcome names the source version", () => {
    expect(
      outcomeOf({
        jobId: "j",
        kind: "copy",
        installationId: "i",
        fileName: "wtf_1.zip",
        snapshotFileName: "wtf_0.zip",
        sourceName: "Forever Beta",
        error: null,
      }).text,
    ).toBe(
      "Settings copied from Forever Beta. Your previous settings were saved as a safety backup.",
    );
  });

  test("progress says Copying", () => {
    expect(
      jobProgressText({
        jobId: "j",
        kind: "copy",
        installationId: "i",
        phase: "extract",
        done: 1,
        total: 2,
      }),
    ).toBe("Copying… 50%");
  });
});

describe("Settings copy of current settings", () => {
  const now = 1_700_000_000_000;
  const beta = {
    flavor: "_classic_beta_",
    displayName: "Forever Beta",
    installed: true,
    current: { modifiedAt: now - 3_600_000, hasConfig: true },
    backups: [],
  };
  const dialog = (gameRunning: "running" | "not_running" | "unknown") =>
    restoreDialogText(currentSettingsBackup(beta), "Forever", gameRunning, now, {
      name: "Forever Beta",
      related: true,
      current: true,
    });

  test("wording: the source's current settings, backed up into its own list first", () => {
    const d = dialog("not_running");
    expect(d.title).toBe("Copy settings?");
    expect(d.okText).toBe("Copy");
    expect(d.paragraphs[0]).toContain("with Forever Beta's current settings");
    expect(d.paragraphs[0]).not.toContain("backup from");
    expect(d.paragraphs.join(" ")).toContain("Forever Beta's settings are backed up first");
    expect(d.origin).toEqual({ text: "From this device", good: true });
    expect(d.config.defaultOn).toBe(true);
    expect(d.sessionWarning).toBeNull();
  });

  test("the source's WoW running warns that this session's changes aren't included", () => {
    expect(dialog("running").sessionWarning).toBe(
      "WoW is running. It saves addon settings when you log out or reload, so a copy made now won't include this session's changes.",
    );
    expect(dialog("unknown").sessionWarning).toBeNull();
  });

  test("a backup copy never shows the session warning", () => {
    const backup = { ...currentSettingsBackup(beta), createdAt: now - 86_400_000 };
    const d = restoreDialogText(backup, "Forever", "running", now, {
      name: "Forever Beta",
      related: true,
    });
    expect(d.sessionWarning).toBeNull();
  });

  test("current settings without a Config.wtf: the toggle is off and disabled", () => {
    const d = restoreDialogText(
      currentSettingsBackup({ ...beta, current: { modifiedAt: now, hasConfig: false } }),
      "Forever",
      "not_running",
      now,
      { name: "Forever Beta", related: true, current: true },
    );
    expect(d.config).toMatchObject({ defaultOn: false, disabled: true });
  });

  test("Current settings is listed first, only for an installed version that has them", () => {
    const backup = { ...currentSettingsBackup(beta), fileName: "wtf_1.zip" };
    expect(copySourceRows({ ...beta, backups: [backup] })).toEqual([
      { kind: "current" },
      { kind: "backup", backup },
    ]);
    expect(copySourceRows({ ...beta, installed: false, current: null, backups: [backup] })).toEqual(
      [{ kind: "backup", backup }],
    );
    expect(copySourceRows({ ...beta, current: null, backups: [backup] })).toEqual([
      { kind: "backup", backup },
    ]);
  });

  test("progress while the source is backed up", () => {
    const job = { jobId: "j", kind: "copy" as const, installationId: "i", done: 1, total: 4 };
    expect(jobProgressText({ ...job, phase: "scan" })).toBe("Looking at the settings to copy…");
    expect(jobProgressText({ ...job, phase: "compress" })).toBe(
      "Backing up the settings to copy… 25%",
    );
  });
});
