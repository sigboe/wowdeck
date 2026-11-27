/**
 * The frontend's one way to the processes behind it. An `EngineLink` is an
 * adapter: Decky's in production (`deckyEngineLink` in services/backend.ts),
 * the typed fake in tests (`createFakeEngine` in testSupport/fakeEngine.ts).
 * The plugin connects Decky's once, at plugin load; tests connect the fake.
 *
 * Stores take `engine.rpc` at construction and register their event handlers
 * on `engine.events` at module scope. The router subscribes to the link once,
 * on connect, so an event reaches its store while no panel is mounted.
 * Components never subscribe to engine events: they read the stores.
 */

import type { EngineEvent, EventMap, EventName } from "../backend/src/api/contracts";
import type { Bridge, Rpc } from "./services/envelope";

export interface EngineLink {
  /** Call an engine method (main.py forwards it unchanged). */
  rpc: Rpc;
  /** Call one of main.py's own methods. */
  bridge: Bridge;
  /** Hear every engine event; returns the unsubscribe. */
  subscribe(handler: (event: EngineEvent) => void): () => void;
}

export interface EventRouter {
  /** Hear one event by name; returns the unsubscribe. */
  on<K extends EventName>(event: K, handler: (params: EventMap[K]) => void): () => void;
  /** Hand an event to every handler of its name, in registration order. */
  dispatch(event: EngineEvent): void;
}

export function createEventRouter(): EventRouter {
  const handlers = new Map<EventName, Set<(params: never) => void>>();
  return {
    on(event, handler) {
      const set = handlers.get(event) ?? new Set();
      handlers.set(event, set);
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
    dispatch(event) {
      for (const handler of [...(handlers.get(event.event) ?? [])]) {
        try {
          (handler as (params: EngineEvent["params"]) => void)(event.params);
        } catch (e) {
          // One store's failure must not keep the event from the others.
          console.error("wowdeck: engine event handler failed", event.event, e);
        }
      }
    },
  };
}

let link: EngineLink | null = null;
let unsubscribe: (() => void) | null = null;
const router = createEventRouter();

/** The code `rpc` and `bridge` reject with while no link is connected. */
export const NOT_CONNECTED = "not_connected";

function connected(): EngineLink {
  if (!link) {
    const error = new Error("The engine isn't connected") as Error & { code?: string };
    error.code = NOT_CONNECTED;
    throw error;
  }
  return link;
}

/**
 * The connected engine. `rpc` and `bridge` forward to the link connected
 * when the call is made; `events.on` registers with the one router.
 *
 * Every failure is a rejected promise carrying a `code`, as an engine error
 * envelope's is: a call made while no link is connected rejects with
 * NOT_CONNECTED, so a caller's one `.catch()` covers it. After a plugin
 * reload the previous load's panel can still render once with its link
 * already disconnected (#341), and that link never comes back, so the call
 * rejects rather than waiting for one.
 */
export const engine: { rpc: Rpc; bridge: Bridge; events: Pick<EventRouter, "on"> } = {
  rpc: (async (method, ...params) => connected().rpc(method, ...params)) as Rpc,
  bridge: (async (method, ...args) => connected().bridge(method, ...args)) as Bridge,
  events: { on: router.on },
};

/**
 * Connect `next` (replacing any link connected before) and route its events.
 * Returns the disconnect: the plugin calls it on dismount.
 */
export function connectEngine(next: EngineLink): () => void {
  unsubscribe?.();
  link = next;
  const off = next.subscribe(router.dispatch);
  unsubscribe = off;
  return () => {
    if (unsubscribe === off) {
      off();
      unsubscribe = null;
      link = null;
    }
  };
}
