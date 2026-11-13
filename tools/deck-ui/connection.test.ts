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

test("busy MCP port leaves its tunnel alone while scripts get an owned, cleanable tunnel", async () => {
  const { createTunnel } = await import("./tunnel.mjs");
  let record: any = null;
  let running = false;
  let started: string[] = [];
  const output: string[] = [];
  const io = {
    free: async (port: string) => port === "18080" && !running,
    holder: () => "ssh -L 9222:localhost:8080 other@kaptan",
    read: () => record, write: (_file: string, value: any) => { record = value; },
    remove: () => { record = null; }, identity: () => running ? "birth" : null,
    start: async (args: string[]) => { started = args; running = true; return { pid: 42, identity: "birth" }; },
    stop: (pid: number) => { expect(pid).toBe(42); running = false; },
  };
  const tunnel = createTunnel({ port: "18080", mcpPort: "9222", host: "deck", file: "fixture" }, io, async () => {}, (s: string) => output.push(s));
  await tunnel.up();
  expect(started).toContain("127.0.0.1:18080:localhost:8080");
  expect(started).not.toContain("127.0.0.1:9222:localhost:8080");
  expect(output.join(" ")).toContain("other@kaptan");
  expect(await tunnel.down()).toContain("closed pid 42 to deck; 18080 free");
  record = { pid: 99, identity: "old" };
  expect(await tunnel.down()).toContain("missing or stale pidfile");
});

for (const scenario of ["both-free", "same-port", "scripts-busy", "stale-pid", "bind-failed"]) {
  test(`tunnel ownership: ${scenario}`, async () => {
    const { createTunnel } = await import("./tunnel.mjs");
    let record: any = scenario === "stale-pid" ? { pid: 99, identity: "previous-process" } : null;
    let running = false;
    let stopped = false;
    let args: string[] = [];
    const tunnel = createTunnel({ port: "18080", mcpPort: scenario === "same-port" ? "18080" : "9223", host: "kaptan", file: "fixture" }, {
      free: async () => scenario !== "scripts-busy" && !running,
      holder: () => "ssh other@deck",
      read: () => record,
      write: (_file: string, value: any) => { record = value; },
      remove: () => { record = null; },
      identity: (pid: number) => pid === 99 ? "reused-pid" : running ? "new-process" : null,
      start: async (value: string[]) => { args = value; running = scenario !== "bind-failed"; return { pid: 42, identity: "new-process" }; },
      stop: (pid: number) => { expect(pid).toBe(42); stopped = true; running = false; },
    }, async () => {}, () => {});
    if (scenario === "scripts-busy") {
      await expect(tunnel.up()).rejects.toThrow("scripts port 18080: ssh other@deck");
      expect(args).toEqual([]);
    } else if (scenario === "bind-failed") {
      await expect(tunnel.up()).rejects.toThrow("SSH tunnel exited");
    } else if (scenario === "stale-pid") {
      expect(await tunnel.down()).toContain("stale pidfile");
      expect(stopped).toBe(false);
    } else {
      await tunnel.up();
      expect(args.filter(arg => arg === "-L").length).toBe(scenario === "same-port" ? 1 : 2);
      const before = args;
      await tunnel.up();
      expect(args).toBe(before);
      expect(await tunnel.down()).toContain("18080 free");
      expect(stopped).toBe(true);
    }
  });
}

for (const binds of [true, false]) {
  test(`tunnel startup ${binds ? "allows SSH's connection budget" : "closes its process on timeout"}`, async () => {
    const { createTunnel } = await import("./tunnel.mjs");
    let elapsed = 0;
    let alive = false;
    let record: any;
    let stopped = false;
    const tunnel = createTunnel({ port: "18080", mcpPort: "9222", host: "deck", file: "fixture" }, {
      free: async () => !alive || !binds || elapsed < 5000,
      holder: () => "fixture holder", read: () => record,
      write: (_file: string, value: any) => { record = value; }, remove: () => { record = null; },
      identity: () => alive ? "birth" : null,
      start: async () => { alive = true; return { pid: 42, identity: "birth" }; },
      stop: () => { stopped = true; alive = false; },
    }, async (ms: number) => { elapsed += ms; }, () => {});
    if (binds) {
      await tunnel.up();
      expect(elapsed).toBe(5000);
      await tunnel.down();
    } else {
      await expect(tunnel.up()).rejects.toThrow("owned tunnel closed");
      expect(elapsed).toBe(15000);
    }
    expect(stopped).toBe(true);
    expect(record).toBeNull();
  });
}
