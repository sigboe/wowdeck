import { test, expect } from "bun:test";
import { startTsmSignIn } from "./tsmSignIn";
import type { Rpc } from "./services/envelope";

function harness(states: string[]) {
  const opened: string[] = [];
  let closed = 0;
  let tick: (() => void) | undefined;
  const rpc = (async (method: string) => {
    if (method === "tradeskillmaster.signIn")
      return { authorizeUrl: "https://fixture.invalid/authorize" };
    if (method === "tradeskillmaster.status") return { state: states.shift(), account: null };
    throw new Error(method);
  }) as Rpc;
  const browser = { open: (url: string) => opened.push(url), close: () => closed++ };
  const clock = {
    setInterval: (fn: () => void) => ((tick = fn), 1),
    clearInterval: () => (tick = undefined),
  };
  const step = async () => {
    tick?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { rpc, browser, clock, opened, closed: () => closed, step, watching: () => !!tick };
}

test("sign-in opens the authorize URL and closes the browser once signed in", async () => {
  const h = harness(["signingIn", "signedIn"]);
  await startTsmSignIn(h.rpc, h.browser, h.clock);
  expect(h.opened).toEqual(["https://fixture.invalid/authorize"]);
  await h.step();
  expect(h.closed()).toBe(0);
  await h.step();
  expect(h.closed()).toBe(1);
  expect(h.watching()).toBe(false);
});

test("a cancelled sign-in leaves the browser alone", async () => {
  const h = harness(["off"]);
  await startTsmSignIn(h.rpc, h.browser, h.clock);
  await h.step();
  expect(h.closed()).toBe(0);
  expect(h.watching()).toBe(false);
});
