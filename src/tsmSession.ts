import { tsmStatus } from "./tsmReads";
import type { TradeSkillMasterAuthStatus } from "../backend/src/api/contracts";

/** All views subscribe to the same status resource and poll loop. */
const offStatus: TradeSkillMasterAuthStatus = { state: "off", account: null };
export const tsmSession = {
  get: () => tsmStatus.get("account").data ?? offStatus,
  subscribe: (listener: () => void) => tsmStatus.subscribe("account", listener),
};
export const tsmActionRequired = (status: TradeSkillMasterAuthStatus): boolean =>
  status.state === "signedOut";
export const tsmOptionsSources = (): string[] => ["TradeSkillMaster"];

export function tsmDestinationVisible(
  providers: readonly { id: string; enabled: boolean }[],
): boolean {
  return providers.some((p) => p.id === "TradeSkillMaster" && p.enabled);
}
