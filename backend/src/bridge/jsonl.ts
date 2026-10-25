import type {
  EventMap,
  MethodMap,
  MethodName,
  RpcError,
  RpcEvent,
  RpcMessage,
  RpcRequest,
  RpcResult,
} from "../api/contracts";
import { InstallError, NotFoundError, ProviderError, ValidationError } from "../wow/errors";
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
  if (err instanceof NotFoundError) {
    return "not_found";
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

type Handler<K extends MethodName> = (params: MethodMap[K]["params"]) => Promise<MethodMap[K]["result"]>;

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
    const handler = this.#handlers.get(req.method);
    if (!handler) {
      this.#send({
        id: req.id,
        error: { code: "method_not_found", message: `Unknown method: ${req.method}` },
      } satisfies RpcError);
      return;
    }
    try {
      const result = await handler((req.params ?? {}) as never);
      this.#send({ id: req.id, result } satisfies RpcResult);
    } catch (err) {
      const code = errorCodeFor(err);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[rpc] ${req.method} failed (${code}): ${message}`);
      this.#send({ id: req.id, error: { code, message } } satisfies RpcError);
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
