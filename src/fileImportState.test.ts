/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test";
import {
  fileImport,
  installArchive,
  pickArchive,
  resetFileImport,
  type FileImportView,
} from "./fileImportState";
import type { ArchivePreview, OperationResult } from "./types";

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
