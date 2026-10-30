import type { MethodMap, MethodName } from "../../backend/src/api/contracts";

export interface BackendErrorEnvelope {
  __error: { code: string; message: string };
}

function isEnvelope(value: unknown): value is BackendErrorEnvelope {
  if (typeof value !== "object" || value === null || !("__error" in value)) {
    return false;
  }
  const inner = (value as { __error: unknown }).__error;
  return typeof inner === "object" && inner !== null && "message" in inner;
}

/** Returns the result, or throws an Error carrying the engine's own message. */
export function unwrapBackendResult<R>(value: R | BackendErrorEnvelope): R {
  if (isEnvelope(value)) {
    const err = new Error(value.__error.message) as Error & { code?: string };
    err.code = value.__error.code;
    throw err;
  }
  return value;
}

/** `rpc`'s params argument: optional when the method needs none. */
export type RpcParams<K extends MethodName> =
  Record<never, never> extends MethodMap[K]["params"]
    ? [params?: MethodMap[K]["params"]]
    : [params: MethodMap[K]["params"]];

/** The typed engine caller `rpcVia` builds: what a module that talks to the engine is handed. */
export type Rpc = ReturnType<typeof rpcVia>;

/**
 * A typed caller for every engine method in `MethodMap`, over a raw
 * `(method, params)` transport (main.py's `rpc`). Engine failures arrive
 * as an error envelope and are thrown here.
 */
export function rpcVia(raw: (method: string, params?: object) => Promise<unknown>) {
  return async <K extends MethodName>(
    method: K,
    ...[params]: RpcParams<K>
  ): Promise<MethodMap[K]["result"]> =>
    unwrapBackendResult(
      (await raw(method, params)) as MethodMap[K]["result"] | BackendErrorEnvelope,
    );
}
