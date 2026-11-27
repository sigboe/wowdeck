import { discoverArtwork, preferredArtworkProducts, type Artwork } from "./LaunchArtwork";
import { isLaunchSvg } from "./LaunchSvg";
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
  appId: number;
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
  private scanQueue: Promise<unknown> = Promise.resolve();
  private readonly sources = new Map<string, Source>();
  private readonly attempts = new Map<string, Promise<void>>();
  private readonly completedAttempts = new Set<string>();

  register(source: Source): void {
    if (preferredArtworkProducts.has(source.product))
      this.sources.set(`${this.key(source).key}:${source.appId}`, source);
  }

  /** Relevant activity permits missing artwork to retry; complete entries are
   * checked before discovery and never refreshed. Active work stays shared. */
  retryMissing(prefix?: string): void {
    const prefixes = new Set([...this.sources.values()].map((source) => source.prefix));
    for (const candidate of prefixes) {
      if (prefix && candidate !== prefix) continue;
      this.completedAttempts.delete(candidate);
      this.populate(candidate);
    }
  }

  private key(source: Source) {
    const identity = JSON.stringify([
      source.prefix,
      source.target,
      source.product,
      source.directory ? "client" : "launcher",
      resolve(source.directory ?? source.executable!),
    ]);
    return { identity, key: hash(identity) };
  }

  private async preferred(source: Source): Promise<string | undefined> {
    const { key, identity } = this.key(source);
    try {
      const manifest = await this.read(join(this.directory, `${key}.svg.json`), 16 * 1024);
      const entry = manifest && JSON.parse(new TextDecoder().decode(manifest));
      if (
        entry?.version !== 1 ||
        entry.identity !== identity ||
        entry.product !== source.product ||
        entry.format !== "svg" ||
        !/^[a-f0-9]{64}$/.test(entry.asset) ||
        !/^[a-f0-9]{32}$/.test(entry.catalogue) ||
        !/^[a-f0-9]{32}$/.test(entry.sourceAsset)
      )
        return undefined;
      const bytes = await this.read(join(this.directory, `${entry.asset}.svg`), 256 * 1024);
      return bytes && hash(bytes) === entry.asset && isLaunchSvg(bytes)
        ? `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`
        : undefined;
    } catch {
      return undefined;
    }
  }

  private populate(prefix: string): void {
    if (this.attempts.has(prefix) || this.completedAttempts.has(prefix)) return;
    const work = (async () => {
      const missing: Source[] = [];
      for (const source of this.sources.values()) {
        if (source.prefix === prefix && !(await this.preferred(source))) missing.push(source);
      }
      if (!missing.length) return;
      const scan = this.scanQueue.then(() => discoverArtwork(prefix, this.read));
      this.scanQueue = scan.catch(() => undefined);
      const artwork = await scan;
      for (const source of missing) {
        const image = artwork.get(source.product);
        if (image) await this.savePreferred(source, image);
      }
    })()
      .catch(() => {})
      .finally(() => {
        this.attempts.delete(prefix);
        this.completedAttempts.add(prefix);
      });
    this.attempts.set(prefix, work);
  }

  private async savePreferred(source: Source, image: Artwork): Promise<void> {
    const { key, identity } = this.key(source);
    const asset = hash(image.bytes);
    try {
      await mkdir(this.directory, { recursive: true });
      await this.publish(join(this.directory, `${asset}.svg`), image.bytes);
      await this.publish(
        join(this.directory, `${key}.svg.json`),
        JSON.stringify({
          version: 1,
          identity,
          product: source.product,
          format: "svg",
          asset,
          catalogue: image.catalogue,
          sourceAsset: image.asset,
        }),
      );
      this.changed({ appId: source.appId, targetId: source.target });
    } catch {
      /* Retain the ICO and any previously published preferred entry. */
    }
  }

  private readonly inFlight = new Map<string, Promise<string | undefined>>();
  private readonly executables: ExecutableIconCache;
  private readonly directory: string;

  constructor(
    dataDir: string,
    private readonly read: LaunchIconRead = readLaunchIconFile,
    private readonly replace: (from: string, to: string) => Promise<void> = rename,
    private readonly changed: (change: { appId: number; targetId: string }) => void = () => {},
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
    this.register(source);
    const { key, identity } = this.key(source);
    const hit = this.inFlight.get(key);
    if (hit) return hit;
    const work = (async () => {
      const preferred = preferredArtworkProducts.has(source.product)
        ? await this.preferred(source)
        : undefined;
      if (preferred) return preferred;
      const fallback = await this.load(key, identity, source);
      this.populate(source.prefix);
      return fallback;
    })()
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
