import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstallationForFlavorDir, findFlavorDirs } from "../src/wow/installation/InstallationDetector";
import { WOW_FLAVOR_FOLDERS } from "../src/wow/toc/toc";
import { WowClientType } from "../src/wow/types";

const SCRIPT = join(import.meta.dir, "../../tools/wow-fixtures.sh");
const roots: string[] = [];

function make(...args: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "wowdeck-fixtures-"));
  roots.push(root);
  const run = Bun.spawnSync(["bash", SCRIPT, "--root", root, ...args]);
  expect(run.exitCode).toBe(0);
  return root;
}

afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe("tools/wow-fixtures.sh", () => {
  test("makes one detectable installation per known client folder", async () => {
    const root = make();
    const wow = join(root, "World of Warcraft");
    const dirs = (await findFlavorDirs(root)).map((d) => d.split("/").pop()).sort();
    expect(dirs).toEqual([...WOW_FLAVOR_FOLDERS].sort());
    for (const dir of await findFlavorDirs(root)) {
      const install = await createInstallationForFlavorDir(dir);
      expect(install?.clientType).not.toBe(WowClientType.None);
      expect(install?.version).toBe("1.0.0.99999");
    }
    expect(readdirSync(wow).filter((n) => n.startsWith("_"))).toHaveLength(WOW_FLAVOR_FOLDERS.length);
  });

  test("--only limits the clients, by folder or product code", async () => {
    const root = make("--only", "wow_cn_beta,_classic_titan_");
    const dirs = (await findFlavorDirs(root)).map((d) => d.split("/").pop()).sort();
    expect(dirs).toEqual(["_classic_titan_", "_cn_beta_"]);
  });

  test("refuses a root that holds a World of Warcraft folder it did not make", () => {
    const root = mkdtempSync(join(tmpdir(), "wowdeck-fixtures-"));
    roots.push(root);
    mkdirSync(join(root, "World of Warcraft", "_retail_"), { recursive: true });
    const run = Bun.spawnSync(["bash", SCRIPT, "--root", root]);
    expect(run.exitCode).toBe(1);
    expect(readdirSync(join(root, "World of Warcraft", "_retail_"))).toHaveLength(0);
  });
});
