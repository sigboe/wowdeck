import type { Rpc } from "./services/envelope";

export interface SignInBrowser {
  open(url: string): void;
  /** Leaves the browser page the sign-in finished on. */
  close(): void;
}
export interface SignInTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}
const timers: SignInTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};
let watching: unknown;

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
  clock: SignInTimers = timers,
): Promise<void> {
  const { authorizeUrl } = await rpc("tradeskillmaster.signIn");
  try {
    browser.open(authorizeUrl);
  } catch (error) {
    await rpc("tradeskillmaster.cancel");
    throw error;
  }
  clock.clearInterval(watching);
  let reading = false;
  const handle = clock.setInterval(() => {
    if (reading) return;
    reading = true;
    void rpc("tradeskillmaster.status")
      .then((status) => {
        if (watching !== handle || status.state === "signingIn") return;
        clock.clearInterval(handle);
        watching = undefined;
        if (status.state === "signedIn") browser.close();
      })
      .catch(() => {})
      .finally(() => {
        reading = false;
      });
  }, 1000);
  watching = handle;
}
