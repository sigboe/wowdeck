/** RPC handlers: The daily update check behind the SteamOS toast. */

import type { HandlerTable } from "../../bridge/jsonl";
import type { UpdateToastGate } from "../../wow/notifications/UpdateToastGate";

/** What the notification handlers use. */
export interface NotificationsDeps {
  updateToastGate: Pick<UpdateToastGate, "checkNow">;
}

export function notificationsHandlers({ updateToastGate }: NotificationsDeps) {
  return {
    "notifications.checkUpdateToast": async () => updateToastGate.checkNow(),
  } satisfies Partial<HandlerTable>;
}
