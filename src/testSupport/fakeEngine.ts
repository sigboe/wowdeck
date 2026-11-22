import type {
  BridgeMethodMap,
  BridgeMethodName,
  EngineEvent,
  MethodMap,
  MethodName,
} from "../../backend/src/api/contracts";
import type { EngineLink } from "../engineLink";
import { bridgeVia, rpcVia, type Bridge, type Rpc } from "../services/envelope";

/** An engine failure the fake answers with: the `{ __error }` envelope main.py returns. */
export interface EngineFailure {
  readonly __fakeFailure: { code: string; message: string };
}

/** Answer a call with the engine's error envelope (`rpc` throws it with `message`). */
export function engineFailure(code: string, message = code): EngineFailure {
  return { __fakeFailure: { code, message } };
}

type Result<K extends MethodName> = MethodMap[K]["result"];

/**
 * How the fake answers one method at once: its result, a function of the
 * params, an `engineFailure`, or an `Error` (a lost Decky call: the
 * transport rejects with it).
 */
export type Answer<K extends MethodName> =
  | Result<K>
  | EngineFailure
  | Error
  | ((params: MethodMap[K]["params"]) => Result<K> | EngineFailure | Promise<Result<K>>);

/** Immediate answers by method. A method with none waits for the test (`next`, `pending`). */
export type Answers = { [K in MethodName]?: Answer<K> };

export type BridgeAnswers = {
  [K in BridgeMethodName]?:
    | BridgeMethodMap[K]["result"]
    | Error
    | ((...args: BridgeMethodMap[K]["args"]) => BridgeMethodMap[K]["result"]);
};

/** One engine call waiting for the test to answer it. */
export interface PendingCall<K extends MethodName = MethodName> {
  method: K;
  params: MethodMap[K]["params"] | undefined;
  /** Answer with the engine's result. */
  resolve(result: Result<K>): Promise<void>;
  /** Answer with an engine error envelope (`{ __error: { code, message } }`). */
  reject(code: string, message?: string): Promise<void>;
  /** Fail the transport itself, as a lost Decky call would. */
  fail(error: Error): Promise<void>;
}

/**
 * The frontend's second engine adapter: the production typed boundary
 * (`rpcVia`, `bridgeVia`, the error envelope) over a transport the test
 * controls. Every method name, param and result is checked against the
 * contract, so a renamed method or a changed result fails typecheck here.
 */
export interface FakeEngine extends EngineLink {
  /** Immediate answers; change them at any time. */
  answers: Answers;
  bridgeAnswers: BridgeAnswers;
  /** Unanswered calls, oldest first, optionally only one method's. */
  pending<K extends MethodName>(method?: K): PendingCall<K>[];
  /** The oldest unanswered call of `method`; throws when there is none. */
  next<K extends MethodName>(method: K): PendingCall<K>;
  /** Every engine call so far, as "method" or "method {params}". */
  log: string[];
  /** Every engine call so far, with its params as sent. */
  calls: { method: MethodName; params: unknown }[];
  /** Every params object `method` was called with, in order. */
  paramsOf<K extends MethodName>(method: K): (MethodMap[K]["params"] | undefined)[];
  /** Deliver an engine event to every subscriber, as main.py's `backend_event`. */
  emit(event: EngineEvent): void;
}

/** Let the caller apply an answer: a few microtask turns. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

const envelope = (failure: EngineFailure) => ({ __error: failure.__fakeFailure });
const isFailure = (value: unknown): value is EngineFailure =>
  typeof value === "object" && value !== null && "__fakeFailure" in value;

/**
 * A fake engine with `answers` answered at once and every other method
 * deferred. Pass `log` to share a log with the test's own entries.
 */
export function createFakeEngine(
  answers: Answers = {},
  bridgeAnswers: BridgeAnswers = {},
  log: string[] = [],
): FakeEngine {
  const queue: PendingCall[] = [];
  const calls: { method: MethodName; params: unknown }[] = [];
  const listeners = new Set<(event: EngineEvent) => void>();
  const take = (call: PendingCall) => {
    const at = queue.indexOf(call);
    if (at < 0) {
      throw new Error(`${call.method} was already answered`);
    }
    queue.splice(at, 1);
  };
  const raw = async (method: string, params?: object): Promise<unknown> => {
    log.push(params === undefined ? method : `${method} ${JSON.stringify(params)}`);
    calls.push({ method: method as MethodName, params });
    const answer = fake.answers[method as MethodName] as unknown;
    if (answer !== undefined) {
      const value = typeof answer === "function" ? await answer(params ?? {}) : answer;
      if (value instanceof Error) {
        throw value;
      }
      return isFailure(value) ? envelope(value) : value;
    }
    return new Promise<unknown>((resolveRaw, rejectRaw) => {
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
  };
  const rawBridge = async (method: string, ...args: unknown[]): Promise<unknown> => {
    log.push(args.length === 0 ? method : `${method} ${JSON.stringify(args)}`);
    const answer = fake.bridgeAnswers[method as BridgeMethodName] as unknown;
    if (answer === undefined) {
      throw new Error(`the fake engine has no answer for main.py's ${method}`);
    }
    const value = typeof answer === "function" ? answer(...args) : answer;
    if (value instanceof Error) {
      throw value;
    }
    return value;
  };
  const pending = <K extends MethodName>(method?: K) =>
    queue.filter((c) => method === undefined || c.method === method) as PendingCall<K>[];
  const fake: FakeEngine = {
    rpc: rpcVia(raw) as Rpc,
    bridge: bridgeVia(rawBridge) as Bridge,
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    answers,
    bridgeAnswers,
    pending,
    next(method) {
      const [first] = pending(method);
      if (!first) {
        throw new Error(`no pending ${method} call`);
      }
      return first;
    },
    log,
    calls,
    paramsOf: (method) => calls.filter((c) => c.method === method).map((c) => c.params as never),
    emit(event) {
      [...listeners].forEach((l) => l(event));
    },
  };
  return fake;
}
