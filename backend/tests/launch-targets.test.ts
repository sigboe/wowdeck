import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Installation } from "../src/api/contracts";
import { parseProductDb } from "../src/wow/launch/BattleNetInstalls";
import { LaunchIcons } from "../src/wow/launch/LaunchIcons";
import { resolveLaunchEntry } from "../src/wow/launch/LaunchEntries";
import { PRODUCT_DB, productDb, writeProductDb } from "./helpers/productDb";
import { BMP, syntheticPe } from "./helpers/syntheticPe";

const UIDS: Record<string, string> = {
  _retail_: "wow", _classic_: "wow_classic", _classic_era_: "wow_classic_era",
  _forever_: "wowf", _classic_beta_: "wow_classic_beta", _ptr_: "wow_ptr",
  _anniversary_: "wow_classic_anniversary",
};

async function fixture(
  run: (setup: {
    root: string;
    prefix: string;
    shortcut: { exe: string; startDir: string; launchOptions: string };
    add: (
      root: string,
      folder: string,
      gameType: Installation["gameType"],
      options?: { linked?: boolean; listed?: boolean },
    ) => Promise<Installation>;
    resolve: (selected?: string) => ReturnType<typeof resolveLaunchEntry>;
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "wowdeck-launch-targets-"));
  const prefix = join(root, "steamapps/compatdata/42/pfx");
  const icons = new LaunchIcons(join(root, "data"));
  const installs: Installation[] = [];
  const listed: Array<{ uid: string; installPath: string; subfolder: string }> = [];
  const shortcut = {
    appId: 42,
    exe: "Battle.net.exe",
    startDir: "",
    launchOptions: '--exec="launch WoWF"',
  };
  const steam = {
    steamShortcuts: async () => [shortcut],
    steamLibraryFolders: async () => [root],
  };
  try {
    writeProductDb(prefix, []);
    await run({
      root,
      prefix,
      shortcut,
      async add(parent, folder, gameType, { linked = true, listed: inBattleNet = true } = {}) {
        const path = join(parent, folder);
        await mkdir(path, { recursive: true });
        const installation: Installation = {
          id: path,
          path,
          gameType,
          clientName: gameType,
          displayName: gameType,
          clientFullName: gameType,
          addonsPath: join(path, "Interface/AddOns"),
          selected: false,
          source: "detected",
          hidden: false,
          autoUpdateEnabled: true,
          version: null,
          steamGames: linked ? [{ appId: 42, name: "WoW" }] : [],
        };
        installs.push(installation);
        if (inBattleNet) {
          listed.push({ uid: UIDS[folder] ?? folder, installPath: `Z:${parent}`, subfolder: folder });
          await writeFile(join(prefix, PRODUCT_DB), productDb(listed));
        }
        return installation;
      },
      resolve: (selected) => resolveLaunchEntry(42, installs, steam, icons, selected),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("product.db decodes uid, install path and subfolder, skipping other fields", () => {
  const bytes = productDb([
    { uid: "wow_classic_era", installPath: "Z:/home/deck/Applications/World of Warcraft", subfolder: "_classic_era_" },
  ]);
  expect(parseProductDb(bytes)).toEqual([
    { uid: "battle.net", installPath: "C:/Program Files (x86)/Battle.net", subfolder: "" },
    { uid: "wow_classic_era", installPath: "Z:/home/deck/Applications/World of Warcraft", subfolder: "_classic_era_" },
  ]);
  expect(() => parseProductDb(bytes.subarray(0, bytes.length - 3))).toThrow();
});

test("Battle.net stays the target, even with a shortcut product option, until a listed client is remembered", async () => {
  await fixture(async ({ root, add, resolve }) => {
    const wow = join(root, "WoW");
    const retail = await add(wow, "_retail_", "retail");
    const forever = await add(wow, "_forever_", "forever");
    const unrelated = await add(join(root, "other"), "_retail_", "retail", { linked: false, listed: false });
    expect(await resolve()).toMatchObject({ target: { kind: "battlenet" } });
    expect((await resolve())?.targetFolders).toBeUndefined();
    expect(await resolve(retail.id)).toMatchObject({
      targetFolders: [{ path: retail.path, shortName: "Retail" }],
      product: "WoW",
    });
    expect((await resolve(unrelated.id))?.clients.map((client) => client.id)).toEqual([
      "battlenet",
      retail.id,
      forever.id,
    ]);
    expect((await resolve(unrelated.id))?.target.kind).toBe("battlenet");
  });
});

test("clients follow client table order, not discovery order", async () => {
  await fixture(async ({ root, add, resolve }) => {
    const forever = await add(root, "_forever_", "forever");
    const retail = await add(root, "_retail_", "retail");
    await add(root, "_classic_era_", "classic_era");
    expect((await resolve())?.clients.map((client) => client.id)).toEqual([
      "battlenet", retail.id, "classic", forever.id,
    ]);
  });
});

test("only clients Battle.net lists in the shortcut's prefix appear, linked or not", async () => {
  await fixture(async ({ root, prefix, add, resolve }) => {
    const wow = join(root, "WoW");
    // On the Deck (2026-11-19) a leftover _retail_ sat beside Battle.net's installs.
    await add(wow, "_retail_", "retail", { listed: false });
    await add(wow, "_classic_era_", "classic_era", { linked: false });
    const forever = await add(wow, "_forever_", "forever");
    const elsewhere = await add(join(root, "other"), "_classic_", "classic", { listed: false });
    expect((await resolve())?.clients.map((client) => client.id)).toEqual(["battlenet", "classic", forever.id]);
    expect((await resolve(elsewhere.id))?.target.kind).toBe("battlenet");

    await writeFile(join(prefix, PRODUCT_DB), productDb([]));
    expect(await resolve()).toBeNull();
    await rm(join(prefix, PRODUCT_DB));
    expect(await resolve()).toBeNull();
  });
});

test("an unreadable product.db shows no clients", async () => {
  await fixture(async ({ root, prefix, add, resolve }) => {
    await add(root, "_forever_", "forever");
    await writeFile(join(prefix, PRODUCT_DB), new Uint8Array([0x0a, 0x40, 1]));
    expect(await resolve()).toBeNull();
  });
});

test("a symlinked client folder is listed when Battle.net's own path leads to it", async () => {
  await fixture(async ({ root, add, resolve }) => {
    const elsewhere = join(root, "disk/_classic_");
    await mkdir(elsewhere, { recursive: true });
    const wow = join(root, "WoW");
    await mkdir(wow, { recursive: true });
    await symlink(elsewhere, join(wow, "_classic_"));
    const classic = await add(wow, "_classic_", "classic");
    expect(await resolve(classic.id)).toMatchObject({
      target: { id: "classic" },
      product: "WoWC",
      targetFolders: [{ path: elsewhere, shortName: "Classic" }],
    });
  });
});

test("Battle.net's C: paths resolve through the prefix's own drive links", async () => {
  await fixture(async ({ prefix, add, resolve }) => {
    await symlink("../drive_c", join(prefix, "dosdevices/c:"));
    const forever = await add(join(prefix, "drive_c/Program Files (x86)/World of Warcraft"), "_forever_", "forever");
    const entry = await resolve(forever.id);
    expect(entry?.product).toBe("WoWF");
  });
});

const CLASSIC_ROW = { kind: "wow", id: "classic", name: "World of Warcraft Classic", shortName: "Classic" } as const;

test("one Classic row starts any listed Classic with WoWC; other versions leave the menu", async () => {
  await fixture(async ({ root, add, resolve }) => {
    const classic = await add(root, "_classic_", "classic");
    const era = await add(root, "_classic_era_", "classic_era");
    const anniversary = await add(root, "_anniversary_", "classic_era");
    const beta = await add(root, "_classic_beta_", "classic_beta");
    await add(root, "_ptr_", "ptr");
    expect((await resolve())?.clients).toEqual([
      { kind: "battlenet", id: "battlenet", name: "Battle.net", shortName: "Battle.net" },
      CLASSIC_ROW,
    ]);
    // A saved Mists, Era or Anniversary choice is the Classic row now.
    for (const saved of ["classic", classic.id, era.id, anniversary.id]) {
      expect(await resolve(saved)).toMatchObject({
        target: CLASSIC_ROW,
        product: "WoWC",
        targetFolders: [
          { path: classic.path, shortName: "Classic" },
          { path: era.path, shortName: "Classic Era" },
          { path: anniversary.path, shortName: "Anniversary" },
        ],
      });
    }
    // A saved row that left the menu falls back to Battle.net.
    expect((await resolve(beta.id))?.target.kind).toBe("battlenet");
  });
});

test("Classic Era alone still makes the Classic row", async () => {
  await fixture(async ({ root, add, resolve }) => {
    const era = await add(root, "_classic_era_", "classic_era");
    await add(root, "_classic_beta_", "classic_beta");
    await add(root, "_forever_", "forever");
    expect((await resolve())?.clients.map((client) => client.id)).toEqual(["battlenet", "classic", expect.any(String)]);
    expect(await resolve("classic")).toMatchObject({ target: CLASSIC_ROW, targetFolders: [{ path: era.path }] });
  });
});

test("the Classic icon comes from Mists, else Classic Era, else Anniversary", async () => {
  await fixture(async ({ root, add, resolve }) => {
    const pe = syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
    const anniversary = await add(root, "_anniversary_", "classic_era");
    await writeFile(join(anniversary.path, "WowClassic.exe"), pe);
    const era = await add(root, "_classic_era_", "classic_era");
    await writeFile(join(era.path, "WowClassic.exe"), "");
    expect(await (await resolve())?.icons?.classic?.()).toBeUndefined();

    await writeFile(join(era.path, "WowClassic.exe"), pe);
    expect(await (await resolve())?.icons?.classic?.()).toStartWith("data:image/x-icon;base64,");
  });
});

test("Proton's prefix wins over a WINEPREFIX in a Battle.net shortcut's launch options", async () => {
  await fixture(async ({ root, shortcut, add, resolve }) => {
    const forever = await add(root, "_forever_", "forever");
    const decoy = join(root, "decoy/pfx");
    await mkdir(decoy, { recursive: true });
    shortcut.launchOptions = `WINEPREFIX=${decoy} %command% --exec="launch WoWF"`;
    expect((await resolve(forever.id))?.prefixes).toEqual([join(root, "steamapps/compatdata/42/pfx")]);
    expect((await resolve(forever.id))?.product).toBe("WoWF");
  });
});

test("a STEAM_COMPAT_DATA_PATH override moves the prefix and its Battle.net list", async () => {
  await fixture(async ({ root, prefix, shortcut, add, resolve }) => {
    const forever = await add(root, "_forever_", "forever");
    const shared = join(root, "compatdata/NonSteamLaunchers");
    shortcut.launchOptions = `STEAM_COMPAT_DATA_PATH=${shared} %command%`;
    expect(await resolve(forever.id)).toBeNull();

    await mkdir(shared, { recursive: true });
    await symlink(prefix, join(shared, "pfx"));
    expect((await resolve(forever.id))?.prefixes).toEqual([prefix]);
  });
});
