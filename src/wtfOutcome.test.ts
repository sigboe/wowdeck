import { describe, expect, test } from "bun:test";
import {
  errorCodeOf,
  friendlyWtfCallError,
  friendlyWtfError,
  importNotice,
  outcomeOf,
  unknownCancelOutcome,
  unknownOutcome,
  wtfCompletedToast,
} from "./wtfOutcome";

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

describe("outcomeOf", () => {
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

describe("import notice", () => {
  test("another version's zip: names the version (display name) and points at Copy settings", () => {
    const otherVersion = { flavor: "_classic_beta_", displayName: "Forever Beta" };
    expect(importNotice({ alreadyPresent: false, otherVersion })).toBe(
      "Added to Forever Beta's backups. To use it here, choose Copy settings from another version.",
    );
    expect(importNotice({ alreadyPresent: true, otherVersion })).toBe(
      "That backup is already in Forever Beta's backups. To use it here, choose Copy settings from another version.",
    );
  });

  test("this version's zip, or one that records no version: as before", () => {
    expect(importNotice({ alreadyPresent: false, otherVersion: null })).toBe(
      "Backup added to the list.",
    );
    expect(importNotice({ alreadyPresent: true, otherVersion: null })).toBe(
      "That backup is already in the list.",
    );
  });
});

describe("unknown result", () => {
  test("says the result can't be told and what to check, per job and request kind; neither success nor failure", () => {
    expect(unknownOutcome("create", "i1")).toEqual({
      kind: "create",
      installationId: "i1",
      ok: null,
      text: "Couldn't tell whether the backup finished. Check the backup list before trying again.",
    });
    expect(unknownOutcome("restore", "i1").text).toBe(
      "Couldn't tell whether the restore finished. Check your settings in game before trying again.",
    );
    expect(unknownOutcome("copy", "i1").text).toBe(
      "Couldn't tell whether the Settings copy finished. Check your settings in game before trying again.",
    );
    expect(unknownOutcome("import", "i1").text).toBe(
      "Couldn't tell whether the import finished. Check the backup list before trying again.",
    );
    expect(unknownOutcome("delete", "i1").text).toBe(
      "Couldn't tell whether the backup was deleted. Check the backup list before trying again.",
    );
  });

  test("a cancel whose answer was lost", () => {
    expect(unknownCancelOutcome("restore", "i1")).toEqual({
      kind: "restore",
      installationId: "i1",
      ok: null,
      text: "Couldn't tell whether Cancel reached the job. Its result shows here when it ends.",
    });
  });
});
