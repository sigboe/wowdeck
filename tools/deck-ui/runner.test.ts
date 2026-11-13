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

for (const mode of ["ok", "guard-fail", "reload-fail", "engine-only"]) {
  test(`deployment ${mode}: backs up within plugin data and saves the guard before changing settings`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wowdeck-runner-"));
    try {
      const scripts = path.join(root, "tools/deck-ui");
      mkdirSync(scripts, { recursive: true });
      mkdirSync(path.join(root, "backend/src/api"), { recursive: true });
      mkdirSync(path.join(root, "dist"));
      mkdirSync(path.join(root, "backend/out"), { recursive: true });
      writeFileSync(path.join(root, "backend/out/wowdeck-x86_64"), "fixture engine version changed");
      if (mode === "engine-only") writeFileSync(path.join(root, "backend/package.json"), JSON.stringify({ version: "new-fixture" }));
      for (const name of ["deck.mjs", "cdp.mjs", "connection.mjs", "tunnel.mjs", "diagnostics.mjs", "toast.mjs", "active.mjs"]) copyFileSync(path.join(here, name), path.join(scripts, name));
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
        expect(r.text).toContain("engine pid 123→456");
        if (mode === "engine-only") expect(r.text).toContain("up: deployed engine");
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

test("toast capture retains transient notices in order beside controller notifications", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start --limit=5",
    `eval@notificationtoasts '__toast("add","Controller connected")'`,
    `eval@notificationtoasts '__toast("add","Removed BNetToast")'`,
    `eval@notificationtoasts '__toast("text","Removed BNetToast","Removed BNetToast 1.2.3")'`,
    `eval@notificationtoasts '__toast("remove","Removed BNetToast 1.2.3")'`,
    "toast-read",
  ].join("; ")]);
  expect(r.code).toBe(0);
  expect(r.text).toContain("→ observer on notificationtoasts (limit 5");
  expect(r.text).toContain('toast-read → 2 notice(s) ["Controller connected","Removed BNetToast 1.2.3"]');
  expect(r.text).not.toContain("fixture: rpc");
});

test("removing a notice preserves rendered text without hidden descendants", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start",
    `eval@notificationtoasts '__toast("add","Removed BNetToast"); __toast("hidden","Removed BNetToast"," debug detail")'`,
    "toast-read",
    `eval@notificationtoasts '__toast("remove","Removed BNetToast debug detail")'`,
    "toast-read",
  ].join("; ")]);
  expect(r.code).toBe(0);
  expect(r.text.match(/toast-read → 1 notice\(s\) \["Removed BNetToast"\]/g)).toHaveLength(2);
});

test("ambiguous batched node reuse reports incomplete instead of inventing text", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start",
    `eval@notificationtoasts '__toast("add","first"); __toast("reuse","first","second")'`,
    "toast-read",
  ].join("; ")]);
  expect(r.code).toBe(1);
  expect(r.text).toContain("INCOMPLETE: 2 notice(s) missed, 0 retained");
  expect(r.text).not.toContain('["second","second"]');
});

test("unseen detached notices report incomplete without claiming CSS-hidden text was displayed", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start",
    `eval@notificationtoasts '__toast("add","Visible"); __toast("css-hidden","Visible"," SECRET"); __toast("remove","Visible SECRET")'`,
    "toast-read",
  ].join("; ")]);
  expect(r.code).toBe(1);
  expect(r.text).toContain('toast-read → INCOMPLETE: 1 notice(s) missed, 0 retained []');
  expect(r.text).not.toContain('["Visible SECRET"]');
});

test("notices that disappear before delivery report incomplete capture", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start",
    `eval@notificationtoasts '__toast("add","Controller connected"); __toast("add","Removed BNetToast"); __toast("remove","Controller connected"); __toast("remove","Removed BNetToast")'`,
    "toast-read",
  ].join("; ")]);
  expect(r.code).toBe(1);
  expect(r.text).toContain('toast-read → INCOMPLETE: 2 notice(s) missed, 0 retained []');
});

test("reusing an observed node preserves its prior text and marks lost occurrences incomplete", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start",
    `eval@notificationtoasts '__toast("add","first")'`,
    `eval@notificationtoasts '__toast("replace","first","second"); __toast("replace","second","third")'`,
    "toast-read",
  ].join("; ")]);
  expect(r.code).toBe(1);
  expect(r.text).toContain('toast-read → INCOMPLETE: 2 notice(s) missed, 1 retained ["first"]');
});

test("moving a visible notice within one delivery batch neither duplicates it nor loses capture", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start",
    `eval@notificationtoasts '__toast("add","Installed Baganator")'`,
    `eval@notificationtoasts '__toast("move","Installed Baganator"); __toast("move","Installed Baganator")'`,
    "toast-read",
  ].join("; ")]);
  expect(r.code).toBe(0);
  expect(r.text).toContain('toast-read → 1 notice(s) ["Installed Baganator"]');
});

test("separate identical notices are separate entries; DOM churn alone is not", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start --limit=5",
    `eval@notificationtoasts '__toast("add","Installed Baganator")'`,
    `eval@notificationtoasts '__toast("churn")'`,
    `eval@notificationtoasts '__toast("churn")'`,
    `eval@notificationtoasts '__toast("remove","Installed Baganator")'`,
    `eval@notificationtoasts '__toast("add","Installed Baganator")'`,
    "toast-read",
  ].join("; ")]);
  expect(r.code).toBe(0);
  expect(r.text).toContain('toast-read → 2 notice(s) ["Installed Baganator","Installed Baganator"]');
});

test("reset never lets a still-visible old notice overwrite new evidence", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start",
    `eval@notificationtoasts '__toast("add","old")'`,
    "toast-reset",
    `eval@notificationtoasts '__toast("add","new")'`,
    `eval@notificationtoasts '__toast("remove","new")'`,
    "toast-read",
  ].join("; ")]);
  expect(r.code).toBe(0);
  expect(r.text).toContain('toast-read → 1 notice(s) ["new"]');
});

test("toast-reset drops earlier evidence and reports its state", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start --limit=5",
    `eval@notificationtoasts '__toast("add","Removed BNetToast")'`,
    "toast-reset",
    `eval@notificationtoasts '__toast("add","Controller disconnected")'`,
    "toast-read",
  ].join("; ")]);
  expect(r.code).toBe(0);
  expect(r.text).toContain("toast-reset → cleared 1 notice(s)");
  expect(r.text).toContain('toast-read → 1 notice(s) ["Controller disconnected"]');
});

test("explicit stop prints unread history and fails an overflowed capture", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start --limit=1",
    `eval@notificationtoasts '__toast("add","first")'`,
    `eval@notificationtoasts '__toast("add","second")'`,
    "toast-stop",
  ].join("; ")]);
  expect(r.text).toContain('["first"]');
  expect(r.text).toContain("INCOMPLETE");
  expect(r.code).toBe(1);
});

test("overflow reports incomplete evidence and fails the run, never a silent pass", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start --limit=2",
    `eval@notificationtoasts '__toast("add","Removed AtlasLoot")'`,
    `eval@notificationtoasts '__toast("add","Removed BNetToast")'`,
    `eval@notificationtoasts '__toast("add","Removed DeadlyBossMods")'`,
    "toast-read",
  ].join("; ")]);
  expect(r.code).toBe(1);
  expect(r.text).toContain("toast-read → INCOMPLETE: 1 notice(s) missed, 2 retained");
  expect(r.text).toContain('["Removed AtlasLoot","Removed BNetToast"]');
  expect(r.text).toContain("toast cleanup → INCOMPLETE: 1 notice(s) missed, 2 retained");
});

test("toast-stop removes the observer; capture steps without one fail", async () => {
  const stopped = await cli("deck.mjs", ["run", [
    "toast-start --limit=5",
    `eval@notificationtoasts '__toast("add","Removed BNetToast")'`,
    "toast-stop",
    "toast-read",
  ].join("; ")]);
  expect(stopped.code).toBe(1);
  expect(stopped.text).toContain("toast-stop → observer removed; 1 notice(s) retained");
  expect(stopped.text).toContain("FAIL toast-read: no observer; run toast-start first");
  for (const step of ["toast-read", "toast-reset", "toast-stop"]) {
    const r = await cli("deck.mjs", [step]);
    expect(r.code).toBe(1);
    expect(r.text).toContain(`FAIL ${step}: no observer; run toast-start first`);
  }
}, 15000);

test("cleanup emits the final stop snapshot and fails overflow arriving after its read", async () => {
  for (const limit of [1, 2]) {
    const r = await cli("deck.mjs", ["run", [
      `toast-start --limit=${limit}`,
      `eval@notificationtoasts '__toast("add","first")'`,
    ].join("; ")], { CEF_TOAST_ON_STOP: "1" });
    expect(r.code).toBe(limit === 1 ? 1 : 0);
    expect(r.text).toContain(limit === 1 ?
      'toast cleanup → INCOMPLETE: 1 notice(s) missed, 1 retained ["first"]' :
      'toast cleanup → 2 notice(s) ["first","late notice"]');
  }
}, 15000);

test("a normal batch exit cleans up the observer and emits the captured history", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start --limit=5",
    `eval@notificationtoasts '__toast("add","Removed BNetToast")'`,
    `eval@notificationtoasts '__toast("add","Controller connected")'`,
  ].join("; ")]);
  expect(r.code).toBe(0);
  expect(r.text).toContain('toast cleanup → 2 notice(s) ["Removed BNetToast","Controller connected"]');
  expect(r.text).toContain("toast cleanup: observer removed");
});

test("a failed check cleans up and keeps the collected evidence in the output", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start --limit=5",
    `eval@notificationtoasts '__toast("add","Removed BNetToast")'`,
    "expect route = /wrong",
  ].join("; ")]);
  expect(r.code).toBe(1);
  expect(r.text).toContain("FAIL expect route");
  expect(r.text).toContain('toast cleanup → 1 notice(s) ["Removed BNetToast"]');
  expect(r.text).toContain("toast cleanup: observer removed");
});

test("interruptions during the final step or cleanup never report success", async () => {
  for (const sig of ["SIGINT", "SIGTERM"]) {
    const r = await cli("deck.mjs", ["run", `toast-start; eval@notificationtoasts '__interrupt("${sig}")'`]);
    expect(r.code).toBe(130);
    expect(r.text).toContain(`FAIL interrupted by ${sig}`);
    expect(r.text).toContain("toast cleanup: observer removed");
  }
  const cleanup = await cli("deck.mjs", ["toast-start"], { CEF_TOAST_INTERRUPT_STOP: "1" });
  expect(cleanup.code).toBe(130);
  expect(cleanup.text).toContain("FAIL interrupted by SIGTERM");
  expect(cleanup.text).toContain("toast cleanup: observer removed");
}, 15000);

test("a handled interruption stops the batch, cleans up and emits the evidence", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start --limit=5",
    `eval@notificationtoasts '__toast("add","Removed BNetToast")'`,
    `eval@notificationtoasts '__interrupt()'`,
    "toast-read",
  ].join("; ")]);
  expect(r.code).toBe(130);
  expect(r.text).toContain("FAIL interrupted by SIGINT");
  expect(r.text).not.toContain("toast-read →");
  expect(r.text).toContain('toast cleanup → 1 notice(s) ["Removed BNetToast"]');
  expect(r.text).toContain("toast cleanup: observer removed");
});

test("a lost CEF connection reports an incomplete capture, not a pass", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start --limit=5",
    `eval@notificationtoasts '__toast("add","Removed BNetToast")'`,
    "toast-read",
  ].join("; ")], { CEF_TOAST_CLOSE_AFTER: "2" });
  expect(r.code).toBe(1);
  expect(r.text).toContain("FAIL toast-read");
  expect(r.text).toContain("toast cleanup incomplete: could not read history");
  expect(r.text).toContain("toast cleanup incomplete: observer not removed");
  expect(r.text).not.toContain("toast cleanup → 1 notice(s)");
});

test("cleanup failures are reported even when the history was read", async () => {
  const r = await cli("deck.mjs", ["run", [
    "toast-start --limit=5",
    `eval@notificationtoasts '__toast("add","Removed BNetToast")'`,
  ].join("; ")], { CEF_TOAST_STOP_FAIL: "1" });
  expect(r.code).toBe(1);
  expect(r.text).toContain('toast cleanup → 1 notice(s) ["Removed BNetToast"]');
  expect(r.text).toContain("toast cleanup incomplete: observer not removed (fixture: observer stuck)");
});

test("active-document evaluation follows the focus navigation document across QAM and modal changes", async () => {
  const r = await cli("deck.mjs", ["run", [
    `eval --active 'doc.marker + " doc"'`,
    `eval --active 'doc === window.DFL.getFocusNavController().GetActiveNavTree().Root.m_element.ownerDocument'`,
    `eval@SharedJSContext '__nav("modal")'`,
    `eval --active 'doc.marker + " doc"'`,
    `eval@SharedJSContext '__nav("qam")'`,
    `eval --active 'doc.marker + " doc"'`,
  ].join("; ")]);
  expect(r.code).toBe(0);
  expect(r.text).toContain("→ quickaccess doc");
  expect(r.text).toContain("→ true");
  expect(r.text).toContain("→ modal doc");
});

test("no active document fails explicitly instead of evaluating a fallback document", async () => {
  const r = await cli("deck.mjs", ["run", [
    `eval@SharedJSContext '__nav("none")'`,
    `eval --active 'throw new Error("fallback document evaluated")'`,
  ].join("; ")]);
  expect(r.code).toBe(1);
  expect(r.text).toContain("FAIL eval: no active document");
  expect(r.text).not.toContain("fallback document evaluated");
});

test("explicit-target evaluation keeps its target selection beside active mode", async () => {
  const r = await cli("deck.mjs", ["run", [
    `eval@QuickAccess_uid 'document.querySelector(".wowdeck-tab-selected").textContent'`,
    `eval@notificationtoasts '1 + 1'`,
  ].join("; ")]);
  expect(r.code).toBe(0);
  expect(r.text).toContain("→ Get Addons");
  expect(r.text).toContain("→ 2");
  const mixed = await cli("deck.mjs", ["run", `eval@QuickAccess_uid --active 'doc.marker'`]);
  expect(mixed.code).toBe(1);
  expect(mixed.text).toContain("FAIL eval");
  expect(mixed.text).toContain("--active");
});

test("active-document evaluation accepts literal file and stdin input", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "wowdeck-active-eval-"));
  try {
    const file = path.join(root, "script.js");
    writeFileSync(file, `doc.marker + " from file"`);
    const fromFile = await cli("deck.mjs", ["eval", "--active", `--file=${file}`]);
    expect(fromFile.code).toBe(0);
    expect(fromFile.text).toContain("quickaccess from file");
    const fromStdin = await cli("deck.mjs", ["eval", "--active", "--stdin"], {}, `doc.marker + " from stdin"`);
    expect(fromStdin.code).toBe(0);
    expect(fromStdin.text).toContain("quickaccess from stdin");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("active-document evaluation timeout keeps the page-side-work warning", async () => {
  const r = await cli("deck.mjs", ["eval", "--active", `42 /* fixture timeout */`, "--t=120000"]);
  expect(r.code).toBe(1);
  expect(r.text).toContain("timed out after 120000 ms");
  expect(r.text).toContain("page-side work may still be running");
  expect(r.text).toContain("inspect before retrying");
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

test("missing RPC projection reports the field without a TypeError", async () => {
  const r = await cli("deck.mjs", ["rpc", "system.getStatus", "--pick=absent"]);
  expect(r.code).toBe(1);
  expect(r.text).toContain("RPC pick path absent is missing");
  expect(r.text).not.toContain("TypeError");
});

test("invalid run JSON explains the working quoted form", async () => {
  const r = await cli("deck.mjs", ["run", 'rpc system.getStatus {"c":"s"}']);
  expect(r.code).toBe(1);
  expect(r.text).toContain(`run quoting: rpc system.getStatus '{"c":"s"}'`);
});


test("text probe reports the panel's scroll position", async () => {
  const r = await cli("deck.mjs", ["run", 'probe text; eval "window.DFL.getFocusNavController().GetActiveNavTree().m_Root.m_element.scrollTop=300"; probe text']);
  expect(r.code).toBe(0);
  expect(r.text).toContain("scrollTop=[160]");
  expect(r.text).toContain("scrollTop=[300]");
});
