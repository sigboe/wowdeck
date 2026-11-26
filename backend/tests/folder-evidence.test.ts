import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { folderEvidence } from "../src/wow/addons/FolderEvidence";
import { realStageFs } from "../src/wow/fs/StageFs";

const ROOT = "/tmp/opencode/wowdeck-tests/folder-evidence";
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function freshDir(name: string): string {
  const dir = join(ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("folder evidence", () => {
  test("a folder's digest matches the one older builds recorded", async () => {
    // Evidence recorded by older builds sits in state.json; recovery must
    // still verify it, so this digest must never change.
    const dir = freshDir("Pinned");
    writeFileSync(join(dir, "a.txt"), "alpha\n");
    writeFileSync(join(dir, "empty"), "");
    mkdirSync(join(dir, "Sub"));
    writeFileSync(join(dir, "Sub", "b.lua"), "print(1)\n");
    symlinkSync("a.txt", join(dir, "link"));
    expect(await folderEvidence(realStageFs, dir)).toEqual({
      kind: "folder",
      digest: "sha256:0de53a13f26027b52246533fd1674da116a140edbf31035b5b0ab5b8aad894e0",
      files: 3,
      bytes: 15,
    });
  });

  test("a file bigger than one read chunk digests like the whole file", async () => {
    const dir = freshDir("Chunked");
    // not a multiple of any power-of-two chunk size
    const data = Buffer.alloc(3 * 1024 * 1024 + 12345, "Data[1] = { name = 'entry' }\n");
    writeFileSync(join(dir, "Data.lua"), data);
    expect(await folderEvidence(realStageFs, dir)).toEqual({
      kind: "folder",
      digest: `sha256:${sha256(`F Data.lua ${data.length} ${sha256(data)}\n`)}`,
      files: 1,
      bytes: data.length,
    });
  });

  test("large files are digested without holding them in memory", () => {
    // Every install, update, roll back and recovery digests the folders it
    // touches. Each file was read whole, so one 100 MiB sound file grew
    // the engine by about 100 MiB; VoiceOver packs ship many large files.
    const dir = freshDir("BigData");
    const chunk = Buffer.alloc(48 * 1024 * 1024, "Data[1] = { name = 'entry', value = 1 }\n");
    for (const name of ["A.ogg", "B.ogg"]) {
      writeFileSync(join(dir, name), chunk);
    }
    const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "helpers/evidence-peak.ts"), dir]);
    expect(run.stderr.toString()).toBe("");
    expect(run.exitCode).toBe(0);
    const { grownKiB, evidence } = JSON.parse(run.stdout.toString()) as {
      grownKiB: number;
      evidence: { files: number; bytes: number };
    };
    rmSync(dir, { recursive: true, force: true });
    expect(evidence.files).toBe(2);
    expect(evidence.bytes).toBe(2 * chunk.length);
    // read whole, the 48 MiB files grew the process by about 100 MiB;
    // read in chunks, by about 14 MiB of runtime overhead
    expect(grownKiB / 1024).toBeLessThan(32);
  });
});
