import { engine } from "./engineLink";
import { pluginToast, toastError } from "./toast";
import { requestPluginUpdate } from "./pluginUpdate";
import { createSelfUpdateStore } from "./selfUpdateStore";

/** The one self-update store (selfUpdateStore.ts), wired to the engine. */
export const selfUpdateStore = createSelfUpdateStore({
  rpc: engine.rpc,
  toast: pluginToast,
  toastError,
  requestUpdate: requestPluginUpdate,
});

// The WoWDeck download's bytes, for the update panel and the PR builds modal.
engine.events.on("system.downloadProgress", (params) =>
  selfUpdateStore.handleEvent({ event: "system.downloadProgress", params }),
);
