/** A synthetic binary KeyValues `shortcuts.vdf`, the way Steam writes it. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ShortcutFixture {
  appId: number;
  /** Steam's AppName; empty is a shortcut detection can't name. */
  name: string;
  exe: string;
  launchOptions?: string;
}

/** Write `shortcuts` as Steam user 100's shortcuts under the Steam root `steam`. */
export function writeShortcuts(steam: string, shortcuts: ShortcutFixture[]): void {
  const string = (key: string, value: string) => Buffer.from(`\x01${key}\0${value}\0`);
  const records = shortcuts.map((shortcut, index) => {
    const appid = Buffer.alloc(4);
    appid.writeUInt32LE(shortcut.appId);
    return Buffer.concat([
      Buffer.from(`\x00${index}\0\x02appid\0`),
      appid,
      string("AppName", shortcut.name),
      string("Exe", `"${shortcut.exe}"`),
      string("StartDir", ""),
      string("LaunchOptions", shortcut.launchOptions ?? ""),
      Buffer.from([8]),
    ]);
  });
  const config = join(steam, "userdata/100/config");
  mkdirSync(config, { recursive: true });
  writeFileSync(
    join(config, "shortcuts.vdf"),
    Buffer.concat([Buffer.from("\0shortcuts\0"), ...records, Buffer.from([8, 8])]),
  );
}
