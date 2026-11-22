/**
 * Decky's adapter to the two processes behind the frontend, both typed by
 * backend/src/api/contracts.ts. Its `rpc` calls an engine method
 * (`MethodMap`), which main.py forwards unchanged; its `bridge` calls a
 * method main.py answers itself (`BridgeMethodMap`). Only the plugin's load
 * (index.tsx) imports this module; everything else reaches the engine
 * through engineLink.ts.
 *
 * Decky turns any exception raised in main.py into the useless text
 * "Python Exception", so main.py returns engine failures as
 * `{ __error: { code, message } }` (see Plugin._rpc) and both callers
 * rethrow them with the engine's real message.
 */

import { callable, addEventListener, removeEventListener } from "@decky/api";
import type { BridgeEventMap } from "../../backend/src/api/contracts";
import type { EngineLink } from "../engineLink";
import { bridgeVia, rpcVia } from "./envelope";

/**
 * Decky's engine adapter, built when the plugin loads (index.tsx connects
 * it): `callable` and `addEventListener` reach main.py only inside Steam.
 */
export function deckyEngineLink(): EngineLink {
  return {
    rpc: rpcVia(callable<[method: string, params?: object], unknown>("rpc")),
    bridge: bridgeVia((method, ...args) => callable<unknown[], unknown>(method)(...args)),
    subscribe(handler) {
      const listener = addEventListener<[payload: BridgeEventMap["backend_event"]]>(
        "backend_event",
        handler,
      );
      return () => removeEventListener("backend_event", listener);
    },
  };
}
