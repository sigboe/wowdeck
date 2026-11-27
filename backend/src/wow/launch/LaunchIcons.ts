import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ExecutableIconCache,
  executableIcon,
  iconDataUrl,
  isExecutableIco,
  launcherIcon,
} from "./ExecutableIcon";

/** A bounded filesystem read, also used for deterministic I/O fault tests. */
export type LaunchIconRead = (path: string, limit: number) => Promise<Uint8Array | undefined>;
export const readLaunchIconFile: LaunchIconRead = async (path, limit) => {
  try {
    const file = Bun.file(path);
    if (file.size > limit) return undefined;
    const bytes = new Uint8Array(await file.slice(0, limit + 1).arrayBuffer());
    return bytes.length <= limit ? bytes : undefined;
  } catch {
    return undefined;
  }
};

type Source = {
  /** Canonical prefix resolved by launch eligibility. */
  prefix: string;
  target: string;
  /** Battle.net launch product code, or battlenet for the launcher. */
  product: string;
} & ({ executable: string; directory?: never } | { directory: string; executable?: never });

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const MAX_ICO = 1024 * 1024 + 22;

/**
 * Owns launch artwork selection and persistence. Usable entries never expire;
 * neither game updates nor absent executables invalidate them. All disk failures
 * fall back to the source image or the caller's glyph. Callers provide only the
 * eligible target and its source; image bytes never enter launch state.
 *
 * Each source has its own versioned manifest, pointing at immutable content.
 * Publishing the manifest last via rename leaves the old entry intact if a
 * write is interrupted. Separate manifests avoid lost updates between targets.
 */
export class LaunchIcons {
  private readonly inFlight = new Map<string, Promise<string | undefined>>();
  private readonly executables: ExecutableIconCache;
  private readonly directory: string;

  constructor(
    dataDir: string,
    private readonly read: LaunchIconRead = readLaunchIconFile,
    private readonly replace: (from: string, to: string) => Promise<void> = rename,
  ) {
    this.directory = join(dataDir, "launch-icons");
    this.executables = new ExecutableIconCache(
      async (path) => {
        const file = await stat(path).catch(() => undefined);
        return file?.isFile() ? file : undefined;
      },
      (path, size) => this.read(path, size),
    );
  }

  icon(source: Source): Promise<string | undefined> {
    // Include the path as well as the prefix and row: different installations
    // and launchers in the same prefix must not borrow each other's image.
    const identity = JSON.stringify([
      source.prefix,
      source.target,
      source.product,
      source.directory ? "client" : "launcher",
      resolve(source.directory ?? source.executable!),
    ]);
    const key = hash(identity);
    const hit = this.inFlight.get(key);
    if (hit) return hit;
    const work = this.load(key, identity, source)
      .catch(() => undefined)
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, work);
    return work;
  }

  private async load(key: string, identity: string, source: Source): Promise<string | undefined> {
    const manifest = join(this.directory, `${key}.json`);
    try {
      const bytes = await this.read(manifest, 16 * 1024);
      const entry = bytes && JSON.parse(new TextDecoder().decode(bytes));
      if (
        entry?.version === 1 &&
        entry.identity === identity &&
        entry.format === "ico" &&
        typeof entry.asset === "string" &&
        /^[a-f0-9]{64}$/.test(entry.asset)
      ) {
        const ico = await this.read(join(this.directory, `${entry.asset}.ico`), MAX_ICO);
        if (ico && hash(ico) === entry.asset && isExecutableIco(ico)) return iconDataUrl(ico);
      }
    } catch {
      /* A missing, incompatible or corrupt entry can be rebuilt. */
    }

    const icon = source.directory
      ? await executableIcon(source.directory, this.executables)
      : await launcherIcon(source.executable!, this.executables);
    if (!icon) return undefined;
    const bytes = Buffer.from(icon.slice(icon.indexOf(",") + 1), "base64");
    if (!isExecutableIco(bytes)) return undefined;
    const asset = hash(bytes);
    try {
      await mkdir(this.directory, { recursive: true });
      await this.publish(join(this.directory, `${asset}.ico`), bytes);
      await this.publish(manifest, JSON.stringify({ version: 1, identity, format: "ico", asset }));
    } catch {
      /* Persistence is optional; the extracted icon remains usable. */
    }
    return icon;
  }

  private async publish(path: string, bytes: Uint8Array | string): Promise<void> {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, bytes, { flag: "wx" });
      await this.replace(temp, path);
    } finally {
      await rm(temp, { force: true }).catch(() => {});
    }
  }
}
