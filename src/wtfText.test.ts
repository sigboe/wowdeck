import { describe, expect, test } from "bun:test";
import {
  deleteConfirmation,
  backupKindLabel,
  backupOrigin,
  jobPercent,
  jobProgressText,
  keepCurrentConfigFor,
  copySourceHeader,
  copySourceOption,
  copySourceRowLabel,
  copySourceRows,
  copySourceStatus,
  currentSettingsDescription,
  currentSettingsSource,
  copyGameRunningNotice,
  okActionLabel,
  restoreBlockedReason,
  restoreDialogText,
} from "./wtfText";
import type { WtfBackupInfo, WtfJobSnapshot } from "./types";

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

describe("backup row labels", () => {
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

  test("a desktop WowUp backup in another version's list asks the same version question as a restore", () => {
    const d = restoreDialogText({ ...backup, flavor: null }, "Forever", "not_running", now, {
      name: "Forever Beta",
      related: true,
    });
    expect(d.acceptUnknownFlavor).toBe(true);
    expect(d.paragraphs).toContain(
      "This backup was made by WowUp and doesn't say which WoW version it is for. Only continue if it is for Forever Beta.",
    );
  });

  test("why a copy can't start is worded for a copy", () => {
    const valid = { valid: true, invalidReason: null };
    expect(
      restoreBlockedReason(
        { valid: false, invalidReason: "Damaged" },
        false,
        "not_running",
        "copy",
      ),
    ).toBe("This backup can't be copied: Damaged");
    expect(
      restoreBlockedReason({ valid: false, invalidReason: null }, false, "not_running", "copy"),
    ).toBe("This backup can't be copied.");
    expect(restoreBlockedReason(valid, true, "not_running", "copy")).toBe(
      "Settings are already being backed up, restored or copied. Wait for it to finish.",
    );
    expect(restoreBlockedReason(valid, false, "running", "copy")).toBe(
      "Close World of Warcraft first.",
    );
    expect(restoreBlockedReason(valid, false, "unknown", "copy")).toBeNull();
  });

  test("a restore keeps its own wording", () => {
    expect(
      restoreBlockedReason(
        { valid: false, invalidReason: "Damaged" },
        false,
        "not_running",
        "restore",
      ),
    ).toBe("This backup can't be restored: Damaged");
  });

  test("a row's A label says Details when the action is blocked", () => {
    expect(okActionLabel(null, "Copy")).toBe("Copy");
    expect(okActionLabel("Close World of Warcraft first.", "Copy")).toBe("Details");
  });

  test("WoW running blocks every copy, and the copy screen says it may be the source version", () => {
    expect(copyGameRunningNotice("running")).toBe(
      "World of Warcraft is running. Close it to copy settings, even when it's the version you copy from.",
    );
    expect(copyGameRunningNotice("not_running")).toBeNull();
    expect(copyGameRunningNotice("unknown")).toBeNull();
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
  /** A backup of `beta` in its list. */
  const betaBackup = (over: Partial<WtfBackupInfo> = {}): WtfBackupInfo => ({
    fileName: "wtf_1.zip",
    sizeBytes: 1_000,
    createdAt: now - 86_400_000,
    kind: "manual",
    fileCount: 1,
    flavor: beta.flavor,
    hasConfig: true,
    fromThisDevice: true,
    keepConfigSuggested: false,
    valid: true,
    invalidReason: null,
    ...over,
  });
  const dialog = (gameRunning: "running" | "not_running" | "unknown") =>
    restoreDialogText(currentSettingsSource(beta), "Forever", gameRunning, now, {
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
  });

  test("WoW running blocks a copy of current settings too: the dialog says it must be closed", () => {
    expect(dialog("running").paragraphs).toContain("World of Warcraft must be closed.");
    expect(restoreBlockedReason(currentSettingsSource(beta), false, "running", "copy")).toBe(
      "Close World of Warcraft first.",
    );
  });

  test("current settings without a Config.wtf: the toggle is off and disabled", () => {
    const d = restoreDialogText(
      currentSettingsSource({ ...beta, current: { modifiedAt: now, hasConfig: false } }),
      "Forever",
      "not_running",
      now,
      { name: "Forever Beta", related: true, current: true },
    );
    expect(d.config).toMatchObject({ defaultOn: false, disabled: true });
  });

  test("Current settings is listed first, only for an installed version that has them", () => {
    const backup = betaBackup();
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

  test("the list names its source: the header and every row", () => {
    const backup = betaBackup({ createdAt: now - 3 * 86_400_000, sizeBytes: 2_100_000 });
    expect(copySourceHeader(beta)).toBe("Copying from Forever Beta");
    expect(copySourceRowLabel(beta, { kind: "current" }, now)).toBe(
      "Forever Beta · Current settings",
    );
    expect(currentSettingsDescription(currentSettingsSource(beta), now)).toBe("Changed 1 hour ago");
    expect(copySourceRowLabel(beta, { kind: "backup", backup }, now)).toBe(
      "Forever Beta · 3 days ago · 2.1 MB",
    );
  });

  test("a version that isn't installed labels its backup rows the same way", () => {
    const anniversary = { displayName: "Anniversary", installed: false, current: null };
    const backup = betaBackup({
      flavor: "_anniversary_",
      createdAt: now - 7_200_000,
      sizeBytes: 38_000,
    });
    expect(copySourceHeader(anniversary)).toBe("Copying from Anniversary");
    expect(copySourceRowLabel(anniversary, { kind: "backup", backup }, now)).toBe(
      "Anniversary · 2 hours ago · 38 KB",
    );
  });

  test("progress while the source is backed up", () => {
    const job = { jobId: "j", kind: "copy" as const, installationId: "i", done: 1, total: 4 };
    expect(jobProgressText({ ...job, phase: "scan" })).toBe("Looking at the settings to copy…");
    expect(jobProgressText({ ...job, phase: "compress" })).toBe(
      "Backing up the settings to copy… 25%",
    );
  });
});
