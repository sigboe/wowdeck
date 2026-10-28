import { describe, expect, test } from "bun:test";
import type { WtfBackupInfo, WtfListResult } from "./types";
import { loadedBackupFocus } from "./wtfBackupFocus";

const list = (over: Partial<WtfListResult> = {}): WtfListResult => ({
  wtfExists: true,
  backupDir: "/data/wtf-backups/retail",
  dirAvailable: true,
  backups: [],
  totalBackupBytes: 0,
  gameRunning: "not_running",
  job: null,
  ...over,
});

describe("loadedBackupFocus", () => {
  test("no backups yet: Back up now", () => {
    expect(loadedBackupFocus(list(), false)).toBe("backUp");
  });

  test("no WTF folder: Import from file", () => {
    expect(loadedBackupFocus(list({ wtfExists: false }), false)).toBe("import");
  });

  test("a job running: neither action can take focus", () => {
    expect(loadedBackupFocus(list(), true)).toBeNull();
  });

  test("backup folder unavailable: neither action can take focus", () => {
    expect(loadedBackupFocus(list({ dirAvailable: false }), false)).toBeNull();
  });

  test("backups listed: their rows already take focus, so none is requested", () => {
    const backup = { fileName: "wtf_1.zip" } as WtfBackupInfo;
    expect(loadedBackupFocus(list({ backups: [backup] }), false)).toBeNull();
  });
});
