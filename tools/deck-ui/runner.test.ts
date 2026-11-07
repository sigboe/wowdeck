import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
async function cli(script: string, args: string[], env: Record<string, string> = {}, input?: string) {
  const proc = Bun.spawn(["node", "--import", `${here}fixtures/cef.mjs`, script.startsWith("/") ? script : `${here}${script}`, ...args], {
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${here}fixtures/cef.mjs`, ...env }, stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([
    proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text(),
  ]);
  return { code, text: out + err };
}

test("a batch preserves quoted JSON and separators, and projects RPC arrays", async () => {
  const r = await cli("deck.mjs", ["run", `# comment\nrpc system.getStatus '{"message":"a;b"}' --pick=params.message; rpc system.getStatus --pick=rows[].name`]);
  expect(r.code).toBe(0);
  expect(r.text).toContain("a;b");
  expect(r.text).toContain('["one","two"]');
});

test("failed expectations stop the batch before the next action", async () => {
  const r = await cli("deck.mjs", ["run", 'expect route = /wrong; eval "42"']);
  expect(r.code).toBe(1);
  expect(r.text).toContain("FAIL expect route");
  expect(r.text).not.toContain("→ 42");
});

test("RPC names and engine errors fail the command", async () => {
  const unknown = await cli("deck.mjs", ["rpc", "system.typo"]);
  expect(unknown.code).toBe(1);
  expect(unknown.text).toContain("unknown method");
  const failed = await cli("deck.mjs", ["rpc", "system.getStatus"], { CEF_RPC_ERROR: "1" });
  expect(failed.code).toBe(1);
  expect(failed.text).toContain("TEST: rpc failed");
});

test("an unterminated run is rejected before executing steps", async () => {
  const r = await cli("deck.mjs", ["run", 'eval "42']);
  expect(r.code).toBe(1);
  expect(r.text).toContain("unterminated quote");
});

test("seek --press --enter activates an already focused match", async () => {
  const r = await cli("seek.mjs", ["QuickAccess", "Get Addons", "--press", "--enter", "--settle=0"]);
  expect(r.code).toBe(0);
  expect(r.text).toContain("fixture: Enter");
});

test("seek refuses to activate a target that rejected focus", async () => {
  const r = await cli("seek.mjs", ["QuickAccess", "Get Addons", "--enter"], { CEF_REFUSE: "1" });
  expect(r.code).toBe(1);
  expect(r.text).toContain("could not focus");
  expect(r.text).not.toContain("fixture: Enter");
});

test("CDP connection, protocol and evaluation failures exit with an error", async () => {
  for (const env of [{ CEF_CONNECT_ERROR: "1" }, { CEF_PROTOCOL_ERROR: "1" }, {}]) {
    const r = await cli("eval.mjs", ["SharedJSContext", "throw new Error('page failed')"], env);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/CEF connection failed|protocol failed|page failed/);
  }
});

for (const mode of ["ok", "guard-fail", "reload-fail"]) {
  test(`deployment ${mode}: backs up within plugin data and saves the guard before changing settings`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wowdeck-runner-"));
    try {
      const scripts = path.join(root, "tools/deck-ui");
      mkdirSync(scripts, { recursive: true });
      mkdirSync(path.join(root, "backend/src/api"), { recursive: true });
      mkdirSync(path.join(root, "dist"));
      for (const name of ["deck.mjs", "cdp.mjs", "connection.mjs", "diagnostics.mjs"]) copyFileSync(path.join(here, name), path.join(scripts, name));
      copyFileSync(path.join(here, "../../backend/src/api/contracts.ts"), path.join(root, "backend/src/api/contracts.ts"));
      writeFileSync(path.join(root, "dist/index.js"), "fixture frontend");
      writeFileSync(path.join(root, "main.py"), "fixture bridge");
      const r = await cli(path.join(scripts, "deck.mjs"), ["up", "--no-build"], {
        CEF_DEPLOY: mode, DECK: "unreachable", DECK_HOSTS: "fixture", CEF_TUNNEL: mode === "ok" ? "1" : "",
      });
      expect(r.text).toContain("ssh: fixture");
      expect(r.text).toContain("/home/deck/homebrew/data/wowdeck/test-backups/");
      expect(r.text).not.toContain("/home/deck/wowdeck-backups/");
      if (mode === "guard-fail") {
        expect(r.code).toBe(1);
        expect(r.text).toContain("save autoUpdate guard: guard write failed");
        expect(r.text).not.toContain("fixture: rpc settings.set");
        expect(r.text).not.toContain("fixture: ssh cat >");
      } else if (mode === "reload-fail") {
        expect(r.code).toBe(1);
        expect(r.text).toContain("reload: reload rejected");
        expect(r.text).toContain("backup in /home/deck/homebrew/data/wowdeck/test-backups/");
        expect(r.text).not.toContain("reloaded fixture");
      } else {
        expect(r.code).toBe(0);
        expect(r.text).toContain("fixture: tunnel fixture");
        expect(r.text).toContain("reloaded fixture");
        expect(r.text.indexOf("/guard.json")).toBeLessThan(r.text.indexOf("fixture: rpc settings.set"));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("actions report plugin tab changes even when focus does not move", async () => {
  const r = await cli("deck.mjs", ["key", "right"]);
  expect(r.code).toBe(0);
  expect(r.text).toContain('tab="Options"');
  expect(r.text).not.toContain("no change");
});

test("literal file and stdin evaluation preserve quotes, newlines and separators", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "wowdeck eval-"));
  const source = `(() => {\nconst value = "it's quoted; \\\"yes\\\"";\nreturn value;\n})()`;
  try {
    const file = path.join(root, "script.js");
    writeFileSync(file, source);
    for (const result of [
      await cli("deck.mjs", ["run", `eval '--file=${file}'; expect tab = Get Addons`]),
      await cli("deck.mjs", ["eval", "--stdin"], {}, source),
      await cli("deck.mjs", ["eval", source]),
    ]) {
      expect(result.code).toBe(0);
      expect(result.text).toContain(`it's quoted; "yes"`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("eval forwards a longer timeout and warns that timed-out work may still run", async () => {
  const source = `Promise.resolve("finished") /* fixture long */`;
  const defaultBudget = await cli("deck.mjs", ["eval", source]);
  expect(defaultBudget.code).toBe(1);
  expect(defaultBudget.text).toContain("timed out after 10000 ms; page-side work may still be running");
  const extended = await cli("deck.mjs", ["eval", source, "--t=120000"]);
  expect(extended.code).toBe(0);
  expect(extended.text).toContain("finished");
  const timedOut = await cli("deck.mjs", ["eval", `42 /* fixture timeout */`, "--t=120000"]);
  expect(timedOut.code).toBe(1);
  expect(timedOut.text).toContain("timed out after 120000 ms");
  expect(timedOut.text).toContain("inspect before retrying");
});

test("eval rejects invalid budgets and conflicting script inputs", async () => {
  for (const args of [["42", "--t=0"], ["42", "--t=NaN"], ["42", "--t=-1"], ["42", "--t=1.5"], ["42", "--t=2147483648"], ["42", "--stdin"], ["--file=example.js", "--stdin"]]) {
    const result = await cli("deck.mjs", ["eval", ...args]);
    expect(result.code).toBe(1);
    expect(result.text).toContain("FAIL eval");
  }
});

for (const phase of ["start-stall", "press-stall", "close-stall"]) {
  test(`controller SSH ${phase} is bounded without stopping the owner's sessions`, async () => {
    const result = await cli("deck.mjs", ["press", "a"], { CEF_PAD: phase, DECK: "fixture" });
    expect(result.code).toBe(phase === "close-stall" ? 0 : 1);
    expect(result.text).toContain("fixture: killed controller SSH SIGKILL");
    if (phase !== "close-stall") expect(result.text).toContain("pad SSH timed out");
  });
}

test("local method consistency check needs no device", async () => {
  const result = await cli("deck.mjs", ["methods-check"]);
  expect(result.code).toBe(0);
  expect(result.text).toContain('"missingBridge":[]');
  expect(result.text).toContain('"save_text_file"');
});

test("logs support checkpoints, bounded matching waits and scrubbed diagnostic snapshots", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "wowdeck-logs-"));
  try {
    mkdirSync(path.join(root, "homebrew/logs/wowdeck"), { recursive: true });
    writeFileSync(path.join(root, "homebrew/logs/wowdeck/fixture.log"), 'error: old failure api_key="PRIVATE"\n');
    const env = { CEF_LOG_HOME: root, DECK: "fixture", CEF_DIAG: "1" };
    const read = await cli("deck.mjs", ["log-wait", "failure", "--t=1"], env);
    expect(read.code).toBe(0);
    expect(read.text).not.toContain("PRIVATE");
    const since = await cli("deck.mjs", ["run", "log-mark; log 10 --since=mark; log-wait failure --since=mark --t=1; eval 42"], env);
    expect(since.code).toBe(1);
    expect(since.text).toContain("→ []");
    expect(since.text).toContain("no matching log line before timeout");
    expect(since.text).not.toContain("→ 42");
    const diag = await cli("deck.mjs", ["diagnose"], env);
    expect(diag.code).toBe(0);
    expect(diag.text).toContain('"active":[{"id":"retail","gameType":"retail"}]');
    expect(diag.text).not.toContain("PRIVATE");
    const failed = await cli("deck.mjs", ["diagnose"], { ...env, CEF_DIAG: "", CEF_RPC_ERROR: "1" });
    expect(failed.code).toBe(0);
    expect(failed.text).toContain('"engine":{"error":');
    expect(failed.text).toContain('"ui":');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("log options fail before contacting a device", async () => {
  for (const args of [["log", "101"], ["log-wait", "x", "--t=NaN"], ["log", "--since=mark"]]) {
    const result = await cli("deck.mjs", args);
    expect(result.code).toBe(1);
    expect(result.text).toContain("FAIL");
  }
});

test("frontend reload imports before unloading and never calls the backend reload route", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "wowdeck-bundle-"));
  try {
    const file = path.join(root, "bundle.js");
    writeFileSync(file, 'export default () => ({ title: "fixture" });');
    const result = await cli("deck.mjs", ["reload-frontend", `--file=${file}`], { CEF_RELOAD_TRACE: "1" });
    expect(result.code).toBe(0);
    expect(result.text).toContain("frontend reloaded in memory; backend unchanged");
    writeFileSync(file, 'export default ???');
    const failed = await cli("deck.mjs", ["reload-frontend", `--file=${file}`], { CEF_RELOAD_TRACE: "1" });
    expect(failed.code).toBe(1);
    expect(failed.text).not.toContain("frontend reloaded in memory");
    expect(failed.text).not.toContain("fixture frontend unloaded");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("frontend reload restores a control whose full label exceeds the compact focus probe", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "wowdeck-long-focus-"));
  const label = "Find WoW installations Looks in Steam, Lutris and other game folders";
  try {
    const file = path.join(root, "bundle.js");
    writeFileSync(file, 'export default () => ({ title: "fixture" });');
    const result = await cli("deck.mjs", ["reload-frontend", `--file=${file}`], { CEF_RELOAD_TRACE: "1", CEF_FOCUS: label });
    expect(result.code).toBe(0);
    expect(result.text).toContain("frontend reloaded in memory");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
