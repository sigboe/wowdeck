/** Durable native intent. A restarted browser/engine never silently retries mutation. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ControllerLayoutContext, ControllerLayoutOperation, ControllerLayoutPhase, MethodMap } from "../../api/contracts";
import { ControllerLayoutRecovery } from "./ControllerLayoutRecovery";
import type { ControllerLayoutPreviews } from "./ControllerLayoutPreviews";
const terminal = new Set<ControllerLayoutPhase>(["succeeded", "restored", "failed"]);
const transitions: Record<ControllerLayoutPhase, ControllerLayoutPhase[]> = {
  validating: ["preserving", "failed"],
  preserving: ["preserved", "recovery-required", "failed"],
  preserved: ["applying", "restoring", "recovery-required"],
  applying: ["verifying", "restoring", "recovery-required"],
  verifying: ["succeeded", "restoring", "recovery-required"],
  restoring: ["restored", "recovery-required"],
  "recovery-required": [], succeeded: [], restored: [], failed: [],
};
export class ControllerLayoutOperations {
  private busy = false;
  private previewJobId?: string;
  private recovery: ControllerLayoutRecovery;
  constructor(private dir: string, private previews: Pick<ControllerLayoutPreviews, "authorize" | "status">, homeDir = "") {
    this.recovery = new ControllerLayoutRecovery(join(dir, "recovery"), homeDir);
  }
  async saveRecovery(params: MethodMap["controllerLayouts.saveRecovery"]["params"]) {
    if (this.busy) throw Error("Couldn't preserve controls while another operation is running.");
    this.busy = true;
    try {
      const op = this.live;
      if (!op || op.id !== params.id || op.phase !== "preserving" || op.recoveryId) throw Error("Couldn't replace preserved controls.");
      const saved = await this.recovery.save(op, params.snapshot);
      await this.save({ ...op, recoveryId: saved.recoveryId });
      return saved;
    } finally { this.busy = false; }
  }
  async sealRecovery(params: MethodMap["controllerLayouts.sealRecovery"]["params"]) {
    if (this.busy) throw Error("Couldn't preserve the export while another operation is running.");
    this.busy = true;
    try {
      const op = this.live;
      if (!op || op.id !== params.id || op.phase !== "preserving") throw Error("Couldn't attach this native export.");
      return await this.recovery.seal(op, params.sourceURL);
    } finally { this.busy = false; }
  }
  async readRecovery(id: string) {
    const op = await this.current();
    if (!op || op.id !== id) throw Error("Couldn't find preserved controls.");
    return this.recovery.read(op);
  }
  async prepareRecovery(id: string) {
    if (this.busy) throw Error("Couldn't deliver controls while another operation is running.");
    this.busy = true;
    try {
      const op = await this.current();
      if (!op || op.id !== id || op.phase !== "restoring") throw Error("Couldn't deliver controls outside explicit restoration.");
      return await this.recovery.prepare(op);
    } finally { this.busy = false; }
  }
  async resumeRestore(id: string, nativeOwner: string) {
    if (this.busy) throw Error("Couldn't restore while another operation is running.");
    this.busy = true;
    try {
      const op = await this.current();
      if (!op || op.id !== id || !["succeeded", "recovery-required"].includes(op.phase)) throw Error("Couldn't resume this restoration.");
      if (op.nativeOwner) throw Error("Couldn't restore while native work is still owned by a browser.");
      validateOwner(nativeOwner);
      await this.recovery.read(op, false);
      return await this.save({ ...op, phase: "restoring", nativeOwner });
    } finally { this.busy = false; }
  }
  async release(id: string, nativeOwner: string) {
    if (this.busy) throw Error("Couldn't release while another operation is running.");
    this.busy = true;
    try {
      await this.validation;
      const op = await this.current();
      if (!op || op.id !== id || op.nativeOwner !== nativeOwner) throw Error("Couldn't release another browser's native work.");
      return await this.save({ ...op, nativeOwner: undefined,
        phase: terminal.has(op.phase) ? op.phase : "recovery-required" });
    } finally { this.busy = false; }
  }
  async status(): Promise<ControllerLayoutOperation | null> {
    try {
      const value = JSON.parse(await readFile(join(this.dir, "operation.json"), "utf8")) as ControllerLayoutOperation;
      if (!value.id || !transitions[value.phase] || !value.context || !value.approved) throw Error();
      validateContext(value.context);
      if (value.nativeOwner !== undefined) validateOwner(value.nativeOwner);
      if (!/^[a-f0-9]{64}$/.test(value.approved.sha256) ||
        value.approved.url !== `usercloud://wowdeck-approved/${value.approved.sha256}` ||
        value.approved.accountId !== value.context.accountId ||
        !/^[a-f0-9]{64}$/.test(value.approved.mappings?.[String(value.context.controllerType)] ?? "") ||
        (value.recoveryId !== undefined && (typeof value.recoveryId !== "string" || !value.recoveryId || value.recoveryId.length > 256))) throw Error();
      if (!value.recoveryId && value.phase === "preserving") {
        // An archive may have reached disk before its operation reference did.
        // Reattach it without native replay or requiring the source to survive.
        try {
          await this.recovery.read({ ...value, recoveryId: value.id }, false);
          value.recoveryId = value.id;
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") throw error;
        }
      }
      return terminal.has(value.phase) ? value : { ...value, phase: "recovery-required" };
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw Error("Couldn't read controller recovery state. Further changes are blocked.");
    }
  }
  private validation: Promise<void> = Promise.resolve();
  async settled() { await this.validation; }
  private live?: ControllerLayoutOperation;
  private async save(value: ControllerLayoutOperation) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const temporary = join(this.dir, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    // fsync the intent before any native action can start.
    const { open } = await import("node:fs/promises");
    const handle = await open(temporary, "r");
    try { await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, join(this.dir, "operation.json"));
    const directory = await open(this.dir, "r");
    try { await directory.sync(); } finally { await directory.close(); }
    this.live = value;
    return value;
  }
  async begin(params: MethodMap["controllerLayouts.beginOperation"]["params"]) {
    if (this.busy) throw Error("Couldn't start another controller operation.");
    this.busy = true;
    try {
      validateContext(params.context);
      validateOwner(params.nativeOwner);
      const previous = await this.status();
      if (previous && (previous.nativeOwner || !terminal.has(previous.phase))) throw Error("Couldn't change controls while recovery is required.");
      const preview = this.previews.status(params.previewJobId);
      if (preview.state !== "ready") throw Error("Couldn't find the approved preview.");
      const approved = preview.preview;
      if (approved.accountId !== params.context.accountId || (Object.keys(approved.mappings).length > 0 && !approved.mappings[String(params.context.controllerType)])) throw Error("Couldn't validate these controller mappings.");
      this.previewJobId = params.previewJobId;
      const operation = await this.save({ id: randomUUID(), phase: "validating", nativeOwner: params.nativeOwner, context: structuredClone(params.context), approved });
      this.validation = this.previews.authorize(params.previewJobId).then(async fresh => {
        if (JSON.stringify(fresh) !== JSON.stringify(approved)) throw Error();
        await this.save({ ...operation, phase: "preserving" });
      }).catch(async () => { await this.save({ ...operation, phase: "failed" }); }).catch(() => {});
      return operation;
    } finally { this.busy = false; }
  }
  async advance(params: MethodMap["controllerLayouts.advanceOperation"]["params"]) {
    if (this.busy) throw Error("Couldn't advance controller operation.");
    this.busy = true;
    try {
      const op = this.live;
      if (op?.phase === "validating") throw Error("Couldn't advance while validation is running.");
      if (!op || op.id !== params.id || op.phase !== params.from || !transitions[op.phase].includes(params.phase)) throw Error("Couldn't advance this controller operation. Read its recovery status.");
      if (params.recoveryId && params.phase !== "preserved") throw Error("Couldn't replace recovery evidence.");
      if (params.phase === "preserved" && (!params.recoveryId || params.recoveryId.length > 256)) throw Error("Couldn't establish preserved controls.");
      if (params.phase === "preserved") {
        if (params.recoveryId !== op.recoveryId) throw Error("Couldn't find durable preservation evidence.");
        await this.recovery.read(op);
        await this.recovery.verifyExport(op);
      }
      if (params.phase === "failed" && op.recoveryId) throw Error("Couldn't discard preserved recovery state.");
      if (params.phase === "applying") {
        const approved = await this.previews.authorize(this.previewJobId!, true);
        if (JSON.stringify(approved) !== JSON.stringify(op.approved)) throw Error("Couldn't validate this approved revision.");
      }
      return await this.save({ ...op, phase: params.phase, ...(params.recoveryId ? { recoveryId: params.recoveryId } : {}) });
    } finally { this.busy = false; }
  }
  async current() { return this.live ?? this.status(); }
}
function validateContext(c: ControllerLayoutContext) {
  if (!c || !c.installationId || !Number.isSafeInteger(c.target) || c.target <= 0 ||
    !Number.isSafeInteger(c.accountId) || c.accountId <= 0 || c.accountId > 0xffffffff ||
    !Number.isSafeInteger(c.controllerIndex) || c.controllerIndex < 0 ||
    !Number.isSafeInteger(c.controllerType) || !c.controllerIdentity || !c.selection ||
    c.scope?.state !== "established" || !c.scope.identity || !Array.isArray(c.scope.targets) ||
    !c.scope.targets.length || c.scope.targets.length > 1000 ||
    !c.scope.targets.some(t => t.appId === c.target) ||
    c.scope.targets.some(t => !Number.isSafeInteger(t.appId) || t.appId <= 0 || typeof t.name !== "string" || !t.name) ||
    new Set(c.scope.targets.map(t => t.appId)).size !== c.scope.targets.length)
    throw Error("Couldn't establish the affected controls. Nothing was changed.");
}

function validateOwner(owner: string) {
  if (typeof owner !== "string" || !/^[a-f0-9-]{36}$/.test(owner)) throw Error("Couldn't claim native controller work.");
}
