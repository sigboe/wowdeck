/** Recovery bytes are engine-owned. Native URLs are data, never arbitrary paths. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import type { ControllerLayoutOperation, ControllerLayoutRecoverySnapshot } from "../../api/contracts";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export class ControllerLayoutRecovery {
  constructor(private dir: string, private homeDir: string) {}
  private async source(url: string, account: number) {
    // Workshop and templates need separately evidenced byte resolution. Never
    // export them first to discover bytes: export changes selection itself.
    const match = /^usercloud:\/\/([a-zA-Z0-9 _/-]+)$/.exec(url);
    // Recorded personal edits use autosave:///absolute/account/config/file.vdf.
    // Only the engine resolves it, and the canonical path must stay in this account.
    const autosave = url.startsWith("autosave://") ? url.slice("autosave://".length) : undefined;
    if ((!match && (!autosave || !isAbsolute(autosave) || !autosave.endsWith(".vdf"))) ||
      (match && match[1]!.split("/").some(part => !part || part === "." || part === "..")))
      throw Error("Couldn't preserve the previous layout's bytes. This source isn't supported.");
    const roots = new Set<string>();
    for (const base of [".local/share/Steam", ".steam/steam"]) {
      try { roots.add(await realpath(join(this.homeDir, base, "steamapps/common/Steam Controller Configs", String(account), "config"))); } catch { /* absent installation */ }
    }
    if (roots.size !== 1) throw Error("Couldn't establish the previous layout's folder.");
    const root = [...roots][0]!;
    const path = await realpath(autosave ?? join(root, `${match![1]}.vdf`));
    if (!path.startsWith(root + sep) || !(await stat(path)).isFile() || (await stat(path)).size > 2 * 1024 * 1024)
      throw Error("Couldn't safely read previous controls.");
    return path;
  }
  async save(op: ControllerLayoutOperation, snapshot: ControllerLayoutRecoverySnapshot) {
    validate(snapshot, op);
    const path = await this.source(snapshot.sourceURL, op.context.accountId);
    const bytes = await readFile(path);
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw Error("Couldn't preserve previous controls.");
    const record = { operationId: op.id, context: op.context, snapshot, bytes: bytes.toString("base64"), sha256: hash(bytes) };
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const temporary = join(this.dir, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    const file = await open(temporary, "r");
    try { await file.sync(); } finally { await file.close(); }
    await rename(temporary, join(this.dir, `${op.id}.json`));
    const directory = await open(this.dir, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    return { recoveryId: op.id };
  }
  async seal(op: ControllerLayoutOperation, sourceURL: string) {
    await this.read(op);
    const bytes = await readFile(await this.source(sourceURL, op.context.accountId));
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw Error("Couldn't preserve the native export.");
    const path = join(this.dir, `${op.id}.export.json`);
    // The original pre-export archive is immutable. Export evidence is separate.
    await writeFile(path, JSON.stringify({ sourceURL, bytes: bytes.toString("base64"), sha256: hash(bytes) }), { mode: 0o600, flag: "wx" });
    const file = await open(path, "r");
    try { await file.sync(); } finally { await file.close(); }
    const directory = await open(this.dir, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    return { recoveryId: op.id };
  }
  async verifyExport(op: ControllerLayoutOperation) {
    const record = JSON.parse(await readFile(join(this.dir, `${op.id}.export.json`), "utf8"));
    if (!record.bytes || hash(Buffer.from(record.bytes, "base64")) !== record.sha256) throw Error("Couldn't verify the preserved native export.");
  }
  async read(op: ControllerLayoutOperation, checkSource = true) {
    if (!/^[a-f0-9-]{36}$/.test(op.id) || op.recoveryId !== op.id) throw Error("Couldn't find preserved controls.");
    const record = JSON.parse(await readFile(join(this.dir, `${op.id}.json`), "utf8"));
    validate(record.snapshot, op);
    const bytes = Buffer.from(record.bytes, "base64");
    if (record.operationId !== op.id || JSON.stringify(record.context) !== JSON.stringify(op.context) || hash(bytes) !== record.sha256)
      throw Error("Couldn't verify preserved controls.");
    // Restoring the old selection must not load new personal edits or a silent
    // fallback. Keep archived bytes if the original changed; never overwrite it.
    const current = checkSource ? await readFile(await this.source(record.snapshot.sourceURL, op.context.accountId)) : bytes;
    if (hash(current) !== record.sha256) throw Error("Couldn't restore controls because their source changed. Preserved bytes are retained.");
    return record.snapshot as ControllerLayoutRecoverySnapshot;
  }
}
function validate(s: ControllerLayoutRecoverySnapshot, op: ControllerLayoutOperation) {
  if (!s || typeof s.mapping !== "string" || s.mapping.length > 4 * 1024 * 1024 || typeof s.sourceURL !== "string" ||
    !Array.isArray(s.selections) || !s.selections.length || s.selections.length > 2000) throw Error("Couldn't preserve complete controls.");
  const mapping = JSON.parse(s.mapping);
  if (mapping.type !== op.context.controllerType || !Array.isArray(mapping.sets) || !Array.isArray(mapping.modes)) throw Error("Couldn't preserve controller mappings.");
  const keys = new Set<string>();
  for (const entry of s.selections) {
    const key = `${entry.target}:${entry.selectionType}`;
    if (keys.has(key) || !op.context.scope.targets.some(t => t.appId === entry.target) ||
      !Number.isSafeInteger(entry.selectionType) || entry.selectionType < 0 || entry.selectionType > 1 ||
      typeof entry.present !== "boolean" || (entry.present ? entry.url !== s.sourceURL : entry.url !== undefined))
      throw Error("Couldn't preserve selection semantics.");
    keys.add(key);
  }
  // Both the controller-specific and equivalent-controller override must be
  // explicitly represented, including absence. Unknown absence is not inherited.
  if (op.context.scope.targets.some(t => !keys.has(`${t.appId}:0`) || !keys.has(`${t.appId}:1`))) throw Error("Couldn't preserve every affected selection.");
}
