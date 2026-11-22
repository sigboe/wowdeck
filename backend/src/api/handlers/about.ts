/** RPC handlers: Options › About. */

import type { HandlerTable } from "../../bridge/jsonl";
import type { About } from "../../about/About";

/** What the About handlers use. */
export interface AboutDeps {
  about: Pick<About, "get">;
}

export function aboutHandlers({ about }: AboutDeps) {
  return {
    "about.get": async () => about.get(),
  } satisfies Partial<HandlerTable>;
}
