import type {
  EventMap,
  MethodMap,
  MethodName,
  RpcError,
  RpcEvent,
  RpcMessage,
  RpcRequest,
  Settled,
} from "../api/contracts";
import {
  InstallError,
  NotFoundError,
  PlayLeftToDroidDeckError,
  ProviderError,
  RecoveryRequiredError,
  ValidationError,
} from "../wow/errors";
import { PathEscapeError } from "../wow/fs/safe-fs";
import { WtfBackupError } from "../wow/wtf/errors";

export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** Map domain errors to stable protocol codes. */
export function errorCodeFor(err: unknown): string {
  if (err instanceof EngineError) {
    return err.code;
  }
  if (err instanceof RecoveryRequiredError) {
    return "recovery_required";
  }
  if (err instanceof NotFoundError) {
    return "not_found";
  }
  if (err instanceof PlayLeftToDroidDeckError) {
    return "play_left_to_droiddeck";
  }
  if (err instanceof ValidationError) {
    return "invalid_request";
  }
  if (err instanceof PathEscapeError) {
    return "path_escape";
  }
  if (err instanceof ProviderError) {
    return err.code;
  }
  if (err instanceof WtfBackupError) {
    return err.code;
  }
  if (err instanceof InstallError) {
    return "install_failed";
  }
  return "internal_error";
}

/**
 * Run work that never throws for an expected failure (contracts.ts
 * `Settled`): whatever it throws, even before its first await, comes back
 * as the error a thrown RPC would carry.
 */
export async function settle<T>(work: () => T | Promise<T>): Promise<Settled<T>> {
  try {
    return { result: await work(), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: null, error: { code: errorCodeFor(err), message } };
  }
}

export type Handler<K extends MethodName> = (params: MethodMap[K]["params"]) => Promise<MethodMap[K]["result"]>;

/**
 * A handler for every contract method. Each handler module returns its part
 * (typed `satisfies Partial<HandlerTable>`); the engine merges them into
 * one HandlerTable, so a method without a handler fails the typecheck.
 */
export type HandlerTable = { [K in MethodName]: Handler<K> };

/**
 * Minimal JSONL RPC dispatcher. Reads requests line-by-line on stdin,
 * writes responses and events to stdout. Logging goes to stderr only so it
 * never corrupts the protocol stream.
 */
export class JsonlServer {
  #handlers = new Map<string, (params: never) => Promise<unknown>>();
  #out: (line: string) => void;

  constructor(out: (line: string) => void = (line) => console.log(line)) {
    this.#out = out;
  }

  on<K extends MethodName>(method: K, handler: Handler<K>): void {
    this.#handlers.set(method, handler as (params: never) => Promise<unknown>);
  }

  /** Serve every method in `table`. */
  handle(table: Partial<HandlerTable>): void {
    for (const [method, handler] of Object.entries(table)) {
      this.#handlers.set(method, handler as (params: never) => Promise<unknown>);
    }
  }

  emit<K extends keyof EventMap & string>(event: K, params: EventMap[K]): void {
    this.#send({ event, params } satisfies RpcEvent);
  }

  #send(msg: RpcMessage): void {
    this.#out(JSON.stringify(msg));
  }

  async handleLine(line: string): Promise<void> {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line) as RpcMessage;
    } catch {
      console.error(`[rpc] invalid JSON from bridge: ${line.slice(0, 200)}`);
      return;
    }
    if (!("method" in msg) || typeof msg.method !== "string") {
      console.error("[rpc] message is not a request");
      return;
    }
    const req = msg as RpcRequest;
    const answer = await this.#answer(req.method, req.params);
    this.#send("error" in answer ? { id: req.id, error: answer.error } : { id: req.id, result: answer.result });
  }

  /**
   * Call a method in-process, through the same handler and error mapping as
   * a request on stdin. The result crosses JSON like a wire answer does; an
   * error answer throws an EngineError carrying its code.
   */
  async call<K extends MethodName>(method: K, params: MethodMap[K]["params"]): Promise<MethodMap[K]["result"]> {
    const answer = await this.#answer(method, params);
    if ("error" in answer) {
      throw new EngineError(answer.error.code, answer.error.message);
    }
    return JSON.parse(JSON.stringify(answer.result)) as MethodMap[K]["result"];
  }

  async #answer(method: string, params: unknown): Promise<{ result: unknown } | { error: RpcError["error"] }> {
    const handler = this.#handlers.get(method);
    if (!handler) {
      return { error: { code: "method_not_found", message: `Unknown method: ${method}` } };
    }
    try {
      const result = await handler((params ?? {}) as never);
      // JSON drops an undefined result, and the bridge needs the key.
      return { result: result ?? null };
    } catch (err) {
      const code = errorCodeFor(err);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[rpc] ${method} failed (${code}): ${message}`);
      return { error: { code, message } };
    }
  }

  /**
   * Run the read loop until stdin closes. Requests are handled
   * concurrently: a long one (an install downloads for many seconds) must
   * not hold back the reads behind it (the My Addons list stayed empty
   * until a channel switch finished; owner report, 2026-10-16). Shared
   * state is protected where it lives: AddonService serializes everything
   * that touches the AddOns folder through its gate, and the bridge matches
   * replies to requests by id, so they may come back in any order. A
   * request split across reads is kept until its newline arrives.
   */
  async run(input: AsyncIterable<Uint8Array> = Bun.stdin.stream()): Promise<void> {
    const decoder = new TextDecoder();
    let pending = "";
    const inFlight = new Set<Promise<void>>();
    for await (const chunk of input) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          const handling = this.handleLine(trimmed).finally(() => inFlight.delete(handling));
          inFlight.add(handling);
        }
      }
    }
    const last = (pending + decoder.decode()).trim();
    if (last) {
      inFlight.add(this.handleLine(last));
    }
    await Promise.all(inFlight);
  }
}
