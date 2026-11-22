import { hideOnScreenKeyboard } from "./steamDom/virtualKeyboard";
import { tsmStatus } from "./tsmReads";
import type { KeyedResource } from "./keyedResource";
import type { TradeSkillMasterAuthStatus } from "../backend/src/api/contracts";
import type { Rpc } from "./services/envelope";

export interface SignInBrowser {
  open(url: string): void;
  /** Leaves the browser page the sign-in finished on. */
  close(): void;
}
let watching: (() => void) | undefined;

/** Release the browser watcher when the plugin unloads, not when Options unmounts. */
export function stopTsmSignIn(): void {
  if (!watching) return;
  watching();
  watching = undefined;
  hideOnScreenKeyboard();
}

/**
 * Opens the authorize page in Steam's browser and, once the engine reports
 * signed in, closes it. The redirect goes to the engine on localhost, so the
 * sign-in can only finish in that browser: it is in front when it does.
 * Module state, not a component's: the Quick Access menu closes (and
 * unmounts Options) when the browser opens.
 */
export async function startTsmSignIn(
  rpc: Rpc,
  browser: SignInBrowser,
  status: KeyedResource<TradeSkillMasterAuthStatus> = tsmStatus,
): Promise<void> {
  const { authorizeUrl } = await rpc("tradeskillmaster.signIn");
  try {
    browser.open(authorizeUrl);
  } catch (error) {
    await rpc("tradeskillmaster.cancel");
    throw error;
  }
  watching?.();
  status.put("account", { state: "signingIn", account: null });
  const stop = status.subscribe("account", () => {
    const state = status.get("account").data?.state;
    if (!state || state === "signingIn") return;
    stop();
    watching = undefined;
    hideOnScreenKeyboard();
    if (state === "signedIn") browser.close();
  });
  watching = stop;
}
