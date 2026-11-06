/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test";
import {
  fileImport,
  installArchive as guardedInstallArchive,
  installLabel,
  installedLabel,
  conflictWarning,
  pickArchive,
  removeConflicting,
  resetFileImport,
  takeoverWarning,
  type FileImportView,
} from "./fileImportState";
import type { ArchivePreview, OperationResult } from "./types";

const installArchive = (install: Parameters<typeof guardedInstallArchive>[0]) =>
  guardedInstallArchive(install, () => true);

/**
 * Manual Install's From a file, as a pure state machine (the seam the spec
 * fixes): pick → inspect → install, each step's error landing in a state the
 * pane can render, and everything kept at module scope so the panel's
 * unmount — Steam's own file picker popup — loses nothing. Dependencies are
 * injected; no RPC or picker is touched here.
 */

const preview: ArchivePreview = {
  fileName: "Foo-1.2.zip",
  name: "Foo Addon",
  author: "Someone",
  version: "1.2",
  folders: ["Foo"],
  providerId: "File",
  externalId: "/home/deck/Downloads/Foo-1.2.zip",
  match: { kind: "new" },
};

const initial: FileImportView = fileImport.get();

afterEach(() => {
  resetFileImport();
});

describe("pickArchive", () => {
  test("idle → picking → inspecting → ready with the preview", async () => {
    const turns: FileImportView["phase"][] = [];
    const unsubscribe = fileImport.subscribe(() => turns.push(fileImport.get().phase));
    await pickArchive(
      () => Promise.resolve({ path: "/home/deck/Downloads/Foo-1.2.zip" }),
      (path) => {
        expect(path).toBe("/home/deck/Downloads/Foo-1.2.zip");
        return Promise.resolve({ result: preview, error: null });
      },
    );
    unsubscribe();
    expect(turns).toEqual(["picking", "inspecting", "ready"]);
    expect(fileImport.get()).toEqual({ phase: "ready", preview, error: null });
  });

  test("a cancelled picker is back to idle, with no error", async () => {
    await pickArchive(
      () => Promise.reject(new Error("cancelled")),
      () => {
        throw new Error("inspect must not run");
      },
    );
    expect(fileImport.get()).toEqual(initial);
  });

  test("an inspection error is its own error state with friendly copy", async () => {
    await pickArchive(
      () => Promise.resolve({ path: "/home/deck/Downloads/readme.zip" }),
      () =>
        Promise.resolve({
          result: null,
          error: { code: "archive_no_addons", message: "backend words" },
        }),
    );
    expect(fileImport.get().phase).toBe("error");
    expect(fileImport.get().error).toMatch(/no installable WoW addon folders/i);
    expect(fileImport.get().preview).toBeNull();
  });

  test("a rejected inspection call (never-throws envelope gone) is an error too", async () => {
    await pickArchive(
      () => Promise.resolve({ path: "/home/deck/Downloads/Foo-1.2.zip" }),
      () => Promise.reject(new Error("engine died")),
    );
    expect(fileImport.get().phase).toBe("error");
    expect(fileImport.get().error).toMatch(/engine died/);
  });

  test("survives the panel's unmount: state read after a remount is the live one", async () => {
    let resolveInspect: (v: { result: ArchivePreview | null; error: null }) => void;
    const turn = pickArchive(
      () => Promise.resolve({ path: "/home/deck/Downloads/Foo-1.2.zip" }),
      () => new Promise((resolve) => (resolveInspect = resolve)),
    );
    await Promise.resolve(); // the pick resolves; the inspection starts
    // The picker popup unmounts the panel here; the store keeps the phase.
    expect(fileImport.get().phase).toBe("inspecting");
    resolveInspect!({ result: preview, error: null });
    await turn;
    // The remounted pane reads what the turn left.
    expect(fileImport.get().phase).toBe("ready");
  });
});

describe("installArchive", () => {
  test("a missing installation preserves the preview and never sends the install", async () => {
    await pickArchive(
      () => Promise.resolve({ path: preview.externalId }),
      () => Promise.resolve({ result: preview, error: null }),
    );
    let warnings = 0;
    await guardedInstallArchive(
      async () => {
        throw new Error("must not install");
      },
      () => {
        warnings++;
        return false;
      },
    );
    expect(warnings).toBe(1);
    expect(fileImport.get()).toEqual({ phase: "ready", preview, error: null });
  });
  test("ready → installing → success; installs the preview's provider/path pair", async () => {
    await pickArchive(
      () => Promise.resolve({ path: preview.externalId }),
      () => Promise.resolve({ result: preview, error: null }),
    );
    await installArchive(async (pair) => {
      expect(pair).toEqual({ providerId: "File", externalId: preview.externalId });
      return { operation: { status: "installed" } as OperationResult };
    });
    expect(fileImport.get()).toEqual({ phase: "success", preview, error: null });
  });

  test("a failed operation (the pipeline caught it) is an error with the engine's sentence", async () => {
    await pickArchive(
      () => Promise.resolve({ path: preview.externalId }),
      () => Promise.resolve({ result: preview, error: null }),
    );
    await installArchive(async () => ({
      operation: {
        status: "failed",
        error: "The archive isn't a zip, RAR or 7z archive",
      } as OperationResult,
    }));
    expect(fileImport.get().phase).toBe("error");
    expect(fileImport.get().error).toMatch(/isn't a zip/i);
  });

  test("a thrown RPC error (validation refused the install) is an error too", async () => {
    await pickArchive(
      () => Promise.resolve({ path: preview.externalId }),
      () => Promise.resolve({ result: preview, error: null }),
    );
    // The file was deleted after the preview: getById refuses before staging.
    await installArchive(async () => {
      throw new Error("[archive_unreadable] That file is missing. Was it moved or deleted?");
    });
    expect(fileImport.get().phase).toBe("error");
    expect(fileImport.get().error).toMatch(/missing/i);
  });

  test("ignored when there is nothing to install", async () => {
    await installArchive(async () => {
      throw new Error("must not be called");
    });
    expect(fileImport.get()).toEqual(initial);
  });

  test("from error, browsing again starts over", async () => {
    await pickArchive(
      () => Promise.resolve({ path: "/x/readme.zip" }),
      () => Promise.resolve({ result: null, error: { code: "archive_no_addons", message: "x" } }),
    );
    expect(fileImport.get().phase).toBe("error");
    await pickArchive(
      () => Promise.resolve({ path: preview.externalId }),
      () => Promise.resolve({ result: preview, error: null }),
    );
    expect(fileImport.get()).toEqual({ phase: "ready", preview, error: null });
  });
});

describe("installLabel", () => {
  test("the card's Install button says what the install does to the installed addons", () => {
    expect(installLabel(preview)).toBe("Install");
    expect(
      installLabel({ ...preview, match: { kind: "update", addonId: "a1", name: "RestedXP" } }),
    ).toBe("Updates RestedXP");
    expect(
      installLabel({ ...preview, match: { kind: "reinstall", addonId: "a1", name: "RestedXP" } }),
    ).toBe("Reinstall");
  });
});

/**
 * A file that takes over an addon from a catalogue (ticket #129): the card
 * warns, naming the addon and the source it leaves, and Install stays.
 */
describe("takeover warning", () => {
  const takeover: ArchivePreview = {
    ...preview,
    match: { kind: "takeover", addonId: "a1", name: "RestedXP", providerId: "Curse" },
  };

  test("names the addon and its source in words, before Install", () => {
    expect(takeoverWarning(takeover)).toEqual({
      heading: "This replaces RestedXP from CurseForge",
      detail: "RestedXP will stop updating from CurseForge",
    });
    expect(installLabel(takeover)).toBe("Install");
  });

  test("an addon from another file or link, or none at all, gets no warning", () => {
    expect(takeoverWarning(preview)).toBeNull();
    expect(
      takeoverWarning({ ...preview, match: { kind: "update", addonId: "a1", name: "RestedXP" } }),
    ).toBeNull();
    expect(
      takeoverWarning({
        ...preview,
        match: { kind: "reinstall", addonId: "a1", name: "RestedXP" },
      }),
    ).toBeNull();
  });

  test("after Install the card says the addon was updated", () => {
    expect(installedLabel(takeover)).toBe("Updated RestedXP");
    expect(
      installedLabel({ ...preview, match: { kind: "update", addonId: "a1", name: "RestedXP" } }),
    ).toBe("Updated RestedXP");
    expect(installedLabel(preview)).toBe("Installed");
  });
});

/**
 * Where gamepad focus goes once a pick settles (ticket #128): the preview
 * card's Install after a preview, Browse… after a cancel or a failed
 * inspection. The pane's focus memory is injected like the picker and RPC.
 */
describe("pickArchive focus", () => {
  test("a pick that shows a preview card sends focus to Install", async () => {
    const focused: string[] = [];
    await pickArchive(
      () => Promise.resolve({ path: preview.externalId }),
      () => Promise.resolve({ result: preview, error: null }),
      (key) => focused.push(key),
    );
    expect(focused).toEqual(["file:install"]);
  });

  test("a cancelled pick leaves focus on Browse…", async () => {
    const focused: string[] = [];
    await pickArchive(
      () => Promise.reject(new Error("cancelled")),
      () => {
        throw new Error("inspect must not run");
      },
      (key) => focused.push(key),
    );
    expect(focused).toEqual(["file:browse"]);
  });

  test("a pick whose preview fails leaves focus on Browse…, with the error shown", async () => {
    const focused: string[] = [];
    await pickArchive(
      () => Promise.resolve({ path: "/home/deck/Downloads/readme.zip" }),
      () =>
        Promise.resolve({
          result: null,
          error: { code: "archive_no_addons", message: "backend words" },
        }),
      (key) => focused.push(key),
    );
    expect(focused).toEqual(["file:browse"]);
    expect(fileImport.get().error).toMatch(/no installable WoW addon folders/i);
  });

  test("a superseded pick moves no focus: only the latest turn's does", async () => {
    const focused: string[] = [];
    let resolveFirst: (v: { result: ArchivePreview | null; error: null }) => void;
    const first = pickArchive(
      () => Promise.resolve({ path: preview.externalId }),
      () => new Promise((resolve) => (resolveFirst = resolve)),
      (key) => focused.push(`first:${key}`),
    );
    await Promise.resolve();
    resetFileImport();
    resolveFirst!({ result: preview, error: null });
    await first;
    expect(focused).toEqual([]);
  });
});

/**
 * A file that matches several installed addons (ticket #130): the card
 * refuses Install, names each addon with the folders it shares, and Remove
 * on a row re-checks the same file.
 */
describe("conflict card", () => {
  const conflict: ArchivePreview = {
    ...preview,
    fileName: "RestedXP-5.0.zip",
    name: "RestedXP Guide",
    externalId: "/home/deck/Downloads/RestedXP-5.0.zip",
    match: {
      kind: "conflict",
      records: [
        { addonId: "rxp", name: "RestedXP Guide", folders: ["RestedXP", "RestedXP_Data"] },
        {
          addonId: "rxpc",
          name: "RXP Classic",
          folders: ["RXP_A", "RXP_B", "RXP_C", "RXP_D", "RXP_E"],
        },
      ],
    },
  };
  const updatesGuide: ArchivePreview = {
    ...conflict,
    match: { kind: "update", addonId: "rxp", name: "RestedXP Guide" },
  };
  const showConflict = () => fileImport.set({ phase: "ready", preview: conflict, error: null });

  test("says what is happening, how to fix it, and each addon's shared folders, cut off after three", () => {
    expect(conflictWarning(conflict)).toEqual({
      heading: "This file matches 2 installed addons",
      detail: "Remove one, and the file will update the other",
      rows: [
        { addonId: "rxp", name: "RestedXP Guide", uses: "Uses RestedXP, RestedXP_Data" },
        { addonId: "rxpc", name: "RXP Classic", uses: "Uses RXP_A, RXP_B, RXP_C +2 more" },
      ],
    });
  });

  test("three or more addons: the fix leaves one", () => {
    const three: ArchivePreview = {
      ...conflict,
      match: {
        kind: "conflict",
        records: [
          { addonId: "a", name: "A", folders: ["A"] },
          { addonId: "b", name: "B", folders: ["B"] },
          { addonId: "c", name: "C", folders: ["C"] },
        ],
      },
    };
    expect(conflictWarning(three)).toMatchObject({
      heading: "This file matches 3 installed addons",
      detail: "Remove all but one, and the file will update the one left",
    });
  });

  test("any other preview has no conflict card", () => {
    expect(conflictWarning(preview)).toBeNull();
    expect(conflictWarning(updatesGuide)).toBeNull();
  });

  test("Install stays disabled: pressing it sends nothing", async () => {
    showConflict();
    await installArchive(() => {
      throw new Error("install must not be sent");
    });
    expect(fileImport.get().phase).toBe("ready");
  });

  test("a pick that shows the conflict card sends focus to the first Remove", async () => {
    const focused: string[] = [];
    await pickArchive(
      () => Promise.resolve({ path: conflict.externalId }),
      () => Promise.resolve({ result: conflict, error: null }),
      (key) => focused.push(key),
    );
    expect(focused).toEqual(["file:conflict:rxp:remove"]);
  });

  test("after a Remove the card re-checks the same file: one match left is an update, focus on Install", async () => {
    showConflict();
    const calls: string[] = [];
    const focused: string[] = [];
    await removeConflicting(
      async () => {
        calls.push("remove");
        expect(fileImport.get().preview).toEqual(conflict);
      },
      (path) => {
        calls.push(`inspect ${path}`);
        return Promise.resolve({ result: updatesGuide, error: null });
      },
      (key) => focused.push(key),
    );
    expect(calls).toEqual(["remove", `inspect ${conflict.externalId}`]);
    expect(fileImport.get()).toEqual({ phase: "ready", preview: updatesGuide, error: null });
    expect(installLabel(updatesGuide)).toBe("Updates RestedXP Guide");
    expect(focused).toEqual(["file:install"]);
  });

  test("a Remove that changed nothing keeps the conflict card, focus back on its first Remove", async () => {
    showConflict();
    const focused: string[] = [];
    await removeConflicting(
      async () => {},
      () => Promise.resolve({ result: conflict, error: null }),
      (key) => focused.push(key),
    );
    expect(fileImport.get()).toEqual({ phase: "ready", preview: conflict, error: null });
    expect(focused).toEqual(["file:conflict:rxp:remove"]);
  });

  test("a Remove that rejects still checks the file again, then passes the error on", async () => {
    showConflict();
    const focused: string[] = [];
    const failure = new Error("engine gone");
    await expect(
      removeConflicting(
        () => Promise.reject(failure),
        () => Promise.resolve({ result: conflict, error: null }),
        (key) => focused.push(key),
      ),
    ).rejects.toBe(failure);
    expect(fileImport.get()).toEqual({ phase: "ready", preview: conflict, error: null });
    expect(focused).toEqual(["file:conflict:rxp:remove"]);
  });

  test("a file gone by the re-check is the pick's error, focus on Browse…", async () => {
    showConflict();
    const focused: string[] = [];
    await removeConflicting(
      async () => {},
      () =>
        Promise.resolve({ result: null, error: { code: "archive_unreadable", message: "gone" } }),
      (key) => focused.push(key),
    );
    expect(fileImport.get()).toMatchObject({ phase: "error", preview: null });
    expect(focused).toEqual(["file:browse"]);
  });
});
