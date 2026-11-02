import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
async function cli(script: string, args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["node", "--import", `${here}fixtures/cef.mjs`, script.startsWith("/") ? script : `${here}${script}`, ...args], {
    env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe",
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

for (const mode of ["ok", "guard-fail"]) {
  test(`deployment ${mode}: backs up within plugin data and saves the guard before changing settings`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), "wowdeck-runner-"));
    try {
      const scripts = path.join(root, "tools/deck-ui");
      mkdirSync(scripts, { recursive: true });
      mkdirSync(path.join(root, "backend/src/api"), { recursive: true });
      mkdirSync(path.join(root, "dist"));
      for (const name of ["deck.mjs", "cdp.mjs"]) copyFileSync(path.join(here, name), path.join(scripts, name));
      copyFileSync(path.join(here, "../../backend/src/api/contracts.ts"), path.join(root, "backend/src/api/contracts.ts"));
      writeFileSync(path.join(root, "dist/index.js"), "fixture frontend");
      writeFileSync(path.join(root, "main.py"), "fixture bridge");
      const r = await cli(path.join(scripts, "deck.mjs"), ["up", "--no-build"], { CEF_DEPLOY: mode, DECK: "fixture" });
      expect(r.text).toContain("/home/deck/homebrew/data/wowdeck/test-backups/");
      expect(r.text).not.toContain("/home/deck/wowdeck-backups/");
      if (mode === "guard-fail") {
        expect(r.code).toBe(1);
        expect(r.text).toContain("save autoUpdate guard: guard write failed");
        expect(r.text).not.toContain("fixture: rpc settings.set");
        expect(r.text).not.toContain("fixture: ssh cat >");
      } else {
        expect(r.code).toBe(0);
        expect(r.text).toContain("reloaded fixture");
        expect(r.text.indexOf("/guard.json")).toBeLessThan(r.text.indexOf("fixture: rpc settings.set"));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
