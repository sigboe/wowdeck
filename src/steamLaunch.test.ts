import { describe, expect, test } from "bun:test";
import type { LaunchState } from "../backend/src/api/contracts";
import { createEventRouter } from "./engineLink";
import { createLaunchActions, launchControl, playButtonView } from "./steamLaunch";
import { createFakeEngine } from "./testSupport/fakeEngine";

const target = {
  name: "Forever",
  shortName: "Forever",
  kind: "wow",
  id: "forever",
} as const;
const ready: LaunchState = {
  target,
  clients: [target],
  busy: false,
  entryRunning: true,
  gameRunning: "not_running",
};

describe("the linked game page launch control", () => {
  test("uses the engine's busy state and explains why a running client disables launch", async () => {
    const fake = createFakeEngine({
      "launch.state": { state: ready },
      "launch.start": { state: { ...ready, busy: true } },
    });
    const actions = createLaunchActions(fake.rpc, createEventRouter(), () => {});
    expect(launchControl(await actions.state(42))).toEqual({ label: "Forever", reason: null });
    expect(launchControl(await actions.start(42))).toEqual({
      label: "Forever",
      reason: "Starting…",
    });
    fake.answers["launch.state"] = { state: { ...ready, gameRunning: "running" } };
    expect(launchControl(await actions.state(42))).toEqual({
      label: "Forever",
      reason: "WoW is already running",
    });
    expect(fake.paramsOf("launch.start")).toEqual([{ appId: 42 }]);
  });

  test("a failure emits one toast from the engine event while a refusal is silent", async () => {
    const fake = createFakeEngine({
      "launch.state": { state: ready },
      "launch.start": { state: { ...ready, busy: true } },
    });
    const events = createEventRouter();
    fake.subscribe(events.dispatch);
    const titles: string[] = [];
    const actions = createLaunchActions(fake.rpc, events, (title) => titles.push(title));
    await actions.start(42);
    fake.emit({
      event: "launch.completed",
      params: { appId: 42, clientName: "Forever", outcome: "never-ready" },
    });
    fake.emit({
      event: "launch.completed",
      params: { appId: 42, clientName: "Forever", outcome: "unconfirmed" },
    });
    expect(titles).toEqual(["Couldn't launch Forever"]);
    expect(launchControl(await actions.state(42))?.reason).toBeNull();
  });
});

test("uses the string shortcut game ID and reports an explicit Steam refusal once", async () => {
  const stopped = { ...ready, entryRunning: false };
  const fake = createFakeEngine({
    "launch.start": {
      state: { ...stopped, busy: true },
      steamStart: { gameId: "18130714796645941248", attemptId: "attempt" },
    },
    "launch.steamRefused": () => undefined,
  });
  const events = createEventRouter();
  fake.subscribe(events.dispatch);
  const launches: string[] = [];
  const toasts: string[] = [];
  let showError: ((gameId: string, action: string) => void) | undefined;
  const actions = createLaunchActions(fake.rpc, events, (_title, body) => toasts.push(body), {
    getRunGame: () => (gameId) => {
      launches.push(gameId);
    },
    onError(handler) {
      showError = handler;
      return () => {
        showError = undefined;
      };
    },
  });
  expect(launchControl(stopped, false)?.reason).toBe("Steam launch is unavailable");
  expect(launchControl(stopped, true)?.reason).toBeNull();
  await actions.start(4221385996);
  expect(launches).toEqual(["18130714796645941248"]);
  expect(fake.paramsOf("launch.steamRefused")).toEqual([]);
  showError?.("another entry", "LaunchApp");
  showError?.("18130714796645941248", "VerifyApp");
  expect(fake.paramsOf("launch.steamRefused")).toEqual([]);
  showError?.("18130714796645941248", "LaunchApp");
  showError?.("18130714796645941248", "LaunchApp");
  expect(fake.paramsOf("launch.steamRefused")).toEqual([{ attemptId: "attempt" }]);
  fake.emit({
    event: "launch.completed",
    params: { appId: 4221385996, clientName: "Forever", outcome: "steam-refused" },
  });
  expect(showError).toBeUndefined();
  expect(toasts).toEqual(["Steam couldn’t start the library entry"]);
});

test("Steam's running hint lets Play start a client without Steam's start API", () => {
  const starting = { ...ready, entryRunning: false };
  expect(playButtonView(starting, { remote: false, steamEntryRunning: true })).toEqual({
    steamLabels: false,
    playText: "Play",
  });
  expect(launchControl(starting, false, true)?.reason).toBeNull();
  expect(launchControl(starting, false, false)?.reason).toBe("Steam launch is unavailable");
});

test("an already-running entry works without Steam's start API", async () => {
  const fake = createFakeEngine({ "launch.start": { state: { ...ready, busy: true } } });
  const actions = createLaunchActions(fake.rpc, createEventRouter(), () => {});
  expect(launchControl(ready, actions.canStartSteam())?.reason).toBeNull();
  expect((await actions.start(42))?.busy).toBe(true);
  expect(fake.paramsOf("launch.start")).toEqual([{ appId: 42 }]);
});

test("the selected installation is sent to the linked game's launch API while WoW is running", async () => {
  const retail = {
    ...target,
    kind: "wow",
    id: "retail",
    name: "Retail",
    shortName: "Retail",
  } as const;
  const fake = createFakeEngine({
    "launch.state": { state: { ...ready, gameRunning: "running", clients: [target, retail] } },
    "launch.select": { target: retail },
  });
  const actions = createLaunchActions(fake.rpc, createEventRouter(), () => {});
  expect(launchControl(await actions.state(42))?.reason).toBe("WoW is already running");
  expect(await actions.select(42, "retail")).toEqual(retail);
  expect(fake.paramsOf("launch.select")).toEqual([{ appId: 42, targetId: "retail" }]);
});

test("Classic that Battle.net didn't start points the player at Battle.net's own Play", () => {
  const events = createEventRouter();
  const fake = createFakeEngine();
  fake.subscribe(events.dispatch);
  const toasts: [string, string][] = [];
  createLaunchActions(fake.rpc, events, (title, body) => toasts.push([title, body]));
  fake.emit({
    event: "launch.completed",
    params: { appId: 42, clientName: "Classic", outcome: "not-started" },
  });
  expect(toasts).toEqual([["Battle.net didn't start Classic", "Press Play in Battle.net"]]);
});

test("Steam Play suppresses RunGame both before and during the engine request", async () => {
  for (const playAlreadyPressed of [true, false]) {
    const fake = createFakeEngine();
    let starting = playAlreadyPressed;
    const launches: string[] = [];
    const actions = createLaunchActions(fake.rpc, createEventRouter(), () => {}, {
      getRunGame: () => (id) => {
        launches.push(id);
      },
      isStartingOrRunning: () => starting,
    });
    const start = actions.start(42);
    expect(fake.paramsOf("launch.start")).toEqual([
      { appId: 42, canStartSteam: true, ...(playAlreadyPressed && { steamEntryRunning: true }) },
    ]);
    starting = true;
    await fake.next("launch.start").resolve({
      state: { ...ready, busy: true },
      ...(playAlreadyPressed ? {} : { steamStart: { gameId: "180422148096", attemptId: "one" } }),
    });
    await start;
    expect(launches).toEqual([]);
  }
});

describe("Steam's Play button on a linked page", () => {
  const battlenet = {
    kind: "battlenet",
    id: "battlenet",
    name: "Battle.net",
    shortName: "Battle.net",
  } as const;
  const local = { remote: false, steamEntryRunning: false };

  test("Battle.net running with WoW not running shows the chosen client and Play", () => {
    expect(playButtonView({ ...ready, entryRunning: true }, local)).toEqual({
      steamLabels: false,
      playText: "Play",
    });
    expect(
      playButtonView({ ...ready, entryRunning: false }, { ...local, steamEntryRunning: true }),
    ).toEqual({ steamLabels: false, playText: "Play" });
  });

  test("nothing running shows the chosen client under Steam's own Play label", () => {
    expect(playButtonView({ ...ready, entryRunning: false }, local)).toEqual({
      steamLabels: false,
    });
  });

  test("WoW running or a stream target hands the button back to Steam", () => {
    expect(playButtonView({ ...ready, gameRunning: "running" }, local).steamLabels).toBe(true);
    expect(
      playButtonView({ ...ready, entryRunning: false }, { ...local, remote: true }).steamLabels,
    ).toBe(true);
  });

  test("Battle.net already running as the target keeps Steam's Resume", () => {
    const bnet = { ...ready, target: battlenet, clients: [battlenet] };
    expect(playButtonView({ ...bnet, entryRunning: true }, local).steamLabels).toBe(true);
    expect(
      playButtonView({ ...bnet, entryRunning: false }, { ...local, steamEntryRunning: true })
        .steamLabels,
    ).toBe(true);
    expect(playButtonView({ ...bnet, entryRunning: false }, local)).toEqual({ steamLabels: false });
  });
});
