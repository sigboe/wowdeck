/**
 * The frontend's way to the engine. Every engine method goes through `rpc`,
 * typed by `MethodMap` in backend/src/api/contracts.ts; main.py forwards it
 * unchanged. The few named calls below are main.py's own methods.
 */

import { callable, addEventListener, removeEventListener } from "@decky/api";
import type { BackendEvent, StatusInfo } from "../types";
import { rpcVia, unwrapBackendResult, type BackendErrorEnvelope } from "./envelope";

/**
 * Decky turns any exception raised in main.py into the useless text
 * "Python Exception", so main.py returns engine failures as
 * `{ __error: { code, message } }` (see Plugin._rpc) and these wrappers
 * rethrow them with the engine's real message.
 */
const call = <A extends unknown[], R>(method: string) => {
  const fn = callable<A, R | BackendErrorEnvelope>(method);
  return async (...args: A): Promise<R> => unwrapBackendResult<R>(await fn(...args));
};

/** Call an engine method: `rpc("addons.update", { addonId })`. */
export const rpc = rpcVia(callable<[method: string, params?: object], unknown>("rpc"));

export const getStatus = call<[], StatusInfo>("get_status");
export const readTextFile = call<
  [path: string],
  { ok: boolean; content: string | null; message: string }
>("read_text_file");
export const saveTextFile = call<
  [directory: string, filename: string, content: string],
  { ok: boolean; path: string | null; message: string }
>("save_text_file");

export function onBackendEvent(handler: (event: BackendEvent) => void): () => void {
  const listener = addEventListener<[payload: BackendEvent]>("backend_event", handler);
  return () => removeEventListener("backend_event", listener);
}
