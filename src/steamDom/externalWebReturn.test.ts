import { expect, test } from "bun:test";
import { watchExternalWebLeave, type SteamHistory } from "./externalWebReturn";

/** Steam's main-window history as far as the watcher reads it. */
function fakeHistory(start = "/library/app/1") {
  const listeners = new Set<(location: { pathname: string }, action: string) => void>();
  const history: SteamHistory & { go(pathname: string, action: string): void; count(): number } = {
    location: { pathname: start },
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    go(pathname, action) {
      history.location = { pathname };
      for (const listener of [...listeners]) listener({ pathname }, action);
    },
    count: () => listeners.size,
  };
  return history;
}

/** The watcher's one-second check, run when the test says. */
function manualLater() {
  const due: (() => void)[] = [];
  return {
    later: (callback: () => void) => due.push(callback),
    run: () => due.forEach((c) => c()),
  };
}

test("B out of the browser is a back, reported once, and the watcher stops listening", () => {
  const history = fakeHistory();
  const timer = manualLater();
  const left: boolean[] = [];
  watchExternalWebLeave(history, (back) => left.push(back), timer.later);
  // As on the Deck (2026-11-26): a push, replaces while the page loads, then a pop.
  history.go("/externalweb", "PUSH");
  history.go("/externalweb", "REPLACE");
  expect(left).toEqual([]);
  history.go("/library/app/1", "POP");
  history.go("/library/app/1", "REPLACE");
  timer.run();
  expect(left).toEqual([true]);
  expect(history.count()).toBe(0);
});

test("another way out of the browser is no back", () => {
  const history = fakeHistory();
  const left: boolean[] = [];
  watchExternalWebLeave(history, (back) => left.push(back), manualLater().later);
  history.go("/externalweb", "PUSH");
  history.go("/library/home", "PUSH");
  expect(left).toEqual([false]);
});

test("a browser that never opens counts as left, without a back", () => {
  const history = fakeHistory();
  const timer = manualLater();
  const left: boolean[] = [];
  watchExternalWebLeave(history, (back) => left.push(back), timer.later);
  timer.run();
  expect(left).toEqual([false]);
  expect(history.count()).toBe(0);
  // A later browser is someone else's.
  history.go("/externalweb", "PUSH");
  history.go("/library/app/1", "POP");
  expect(left).toEqual([false]);
});

test("stopping the watcher reports nothing", () => {
  const history = fakeHistory();
  const left: boolean[] = [];
  const stop = watchExternalWebLeave(history, (back) => left.push(back), manualLater().later);
  history.go("/externalweb", "PUSH");
  stop();
  history.go("/library/app/1", "POP");
  expect(left).toEqual([]);
});
