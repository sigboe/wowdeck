import type { MethodMap, MethodName } from "../../backend/src/api/contracts";
import { rpcVia, type Rpc } from "../services/envelope";

/** One engine call the code under test made, waiting for the test to answer it. */
export interface PendingCall<K extends MethodName = MethodName> {
  method: K;
  params: MethodMap[K]["params"] | undefined;
  /** Answer with the engine's result. */
  resolve(result: MethodMap[K]["result"]): Promise<void>;
  /** Answer with an engine error envelope (`{ __error: { code, message } }`). */
  reject(code: string, message?: string): Promise<void>;
  /** Fail the transport itself, as a lost Decky call would. */
  fail(error: Error): Promise<void>;
}

/**
 * The production typed RPC boundary (`rpcVia`) over a transport whose every
 * call waits until the test answers it, in whatever order the test chooses.
 * Answering awaits a few microtask turns so the caller has applied it.
 */
export interface DeferredRpc {
  rpc: Rpc;
  /** Unanswered calls, oldest first, optionally only one method's. */
  pending<K extends MethodName>(method?: K): PendingCall<K>[];
  /** The oldest unanswered call of `method`; throws when there is none. */
  next<K extends MethodName>(method: K): PendingCall<K>;
  /** Every call made so far, as "method" or "method {params}". */
  log: string[];
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

export function createDeferredRpc(): DeferredRpc {
  const queue: PendingCall[] = [];
  const log: string[] = [];
  const raw = (method: string, params?: object) =>
    new Promise<unknown>((resolveRaw, rejectRaw) => {
      log.push(params === undefined ? method : `${method} ${JSON.stringify(params)}`);
      const call: PendingCall = {
        method: method as MethodName,
        params: params as never,
        resolve: async (result) => {
          take(call);
          resolveRaw(result);
          await settle();
        },
        reject: async (code, message = code) => {
          take(call);
          resolveRaw({ __error: { code, message } });
          await settle();
        },
        fail: async (error) => {
          take(call);
          rejectRaw(error);
          await settle();
        },
      };
      queue.push(call);
    });
  const take = (call: PendingCall) => {
    const at = queue.indexOf(call);
    if (at < 0) {
      throw new Error(`${call.method} was already answered`);
    }
    queue.splice(at, 1);
  };
  const pending = <K extends MethodName>(method?: K) =>
    queue.filter((c) => method === undefined || c.method === method) as PendingCall<K>[];
  return {
    rpc: rpcVia(raw),
    pending,
    next(method) {
      const [first] = pending(method);
      if (!first) {
        throw new Error(`no pending ${method} call`);
      }
      return first;
    },
    log,
  };
}
