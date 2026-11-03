import { expect, test } from "bun:test";
import { createConnection, SSH_OPTIONS } from "./connection.mjs";

test("SSH uses isolated, bounded connections and retains the reachable fallback for all commands", async () => {
  const calls: { args: string[]; options: Record<string, unknown> }[] = [];
  const connection = createConnection({ DECK: "wifi", DECK_HOSTS: "wifi, ethernet" }, (command, args, options) => {
    expect(command).toBe("ssh");
    calls.push({ args, options });
    return { code: args.at(-2) === "wifi" ? 1 : 0, err: "spawnSync ssh ETIMEDOUT" };
  }, async () => { throw new Error("unexpected retry"); });
  expect(await connection.up(() => { throw new Error("unexpected wake"); })).toBe(false);
  connection.ssh("deploy", { input: "bundle" });
  connection.ssh("restore");
  expect(connection.host()).toBe("ethernet");
  expect(calls.map(({ args }) => args.slice(-2))).toEqual([
    ["wifi", "true"], ["ethernet", "true"], ["ethernet", "deploy"], ["ethernet", "restore"],
  ]);
  for (const { args, options } of calls) {
    expect(args.slice(0, -2)).toEqual(SSH_OPTIONS);
    expect(args).toContain("none");
    expect(args).toContain("ControlMaster=no");
    expect(args).toContain("ControlPath=none");
    expect(options.timeout).toBe(30000);
    expect(options.killSignal).toBe("SIGKILL");
  }
  expect(calls[2].options.input).toBe("bundle");
});

test("Wake-on-LAN retries every address and picks Ethernet without owner intervention", async () => {
  const attempts: string[] = [];
  let awake = false;
  let wakes = 0;
  const delays: number[] = [];
  const connection = createConnection({ DECK: "wifi", DECK_HOSTS: "ethernet", DECK_WOL_MAC: "fixture" }, (_command, args) => {
    const host = args.at(-2);
    attempts.push(host);
    return { code: awake && host === "ethernet" ? 0 : 1, err: "unreachable" };
  }, async (delay) => { delays.push(delay); });
  expect(await connection.up(() => { wakes++; awake = true; })).toBe(true);
  expect(wakes).toBe(1);
  expect(attempts).toEqual(["wifi", "ethernet", "wifi", "ethernet"]);
  expect(delays).toEqual([15000]);
  expect(connection.host()).toBe("ethernet");
});

test("unreachable Deck retries are finite and retain diagnostics for every address", async () => {
  let attempts = 0;
  let delays = 0;
  const connection = createConnection({ DECK_HOSTS: "wifi,ethernet", DECK_WOL_MAC: "fixture" }, () => {
    attempts++;
    return { code: 1, err: "timed out" };
  }, async () => { delays++; });
  await expect(connection.up(() => {})).rejects.toThrow("wifi: timed out; ethernet: timed out");
  expect(attempts).toBe(18);
  expect(delays).toBe(8);
});

test("missing WOL configuration and failed wake do not retry or hide the cause", async () => {
  const run = () => ({ code: 1, err: "unreachable" });
  const sleep = async () => { throw new Error("unexpected sleep"); };
  const noWake = createConnection({ DECK: "wifi" }, run, sleep);
  await expect(noWake.up(() => { throw new Error("unexpected wake"); })).rejects.toThrow("configure DECK_WOL_MAC");
  const failedWake = createConnection({ DECK: "wifi", DECK_WOL_MAC: "fixture" }, run, sleep);
  await expect(failedWake.up(() => { throw new Error("wake failed"); })).rejects.toThrow("wake failed");
});
