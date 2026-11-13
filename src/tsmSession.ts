import { createStore } from "./store";
import type { TradeSkillMasterAuthStatus } from "../backend/src/api/contracts";
import type { Rpc } from "./services/envelope";

export const tsmSession = createStore<TradeSkillMasterAuthStatus>({ state: "off", account: null });
let reading = false;
export async function readTsmSession(rpc: Rpc, notify: () => void): Promise<void> {
  if (reading) return;
  reading = true;
  try {
    const status = await rpc("tradeskillmaster.status");
    const previous = tsmSession.get().state;
    tsmSession.set(status);
    if (status.state === "signedOut" && previous !== "signedOut") notify();
  } finally {
    reading = false;
  }
}
export const tsmActionRequired = (status: TradeSkillMasterAuthStatus): boolean =>
  status.state === "signedOut";
export const tsmOptionsSources = (): string[] => ["TradeSkillMaster"];

export function tsmDestinationVisible(
  providers: readonly { id: string; enabled: boolean }[],
): boolean {
  return providers.some((p) => p.id === "TradeSkillMaster" && p.enabled);
}
