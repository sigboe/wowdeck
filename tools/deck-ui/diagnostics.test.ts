import { expect, test } from "bun:test";
import vm from "node:vm";
import { checkMethods, reactProbe, redact } from "./diagnostics.mjs";

test("method check finds missing bridge and engine names, including multiline generics", () => {
  const result = checkMethods(`const f = call<[x: string], { ok: boolean; value: string }>("missing");
    const g = callable<[string], number>("rpc"); rpc("addons.typo", {});`,
    "    async def rpc(self):", ["addons.list"]);
  expect(result.missingBridge).toEqual(["missing"]);
  expect(result.unknownRpc).toEqual(["addons.typo"]);
});

test("method check counts calls through the typed bridge caller", () => {
  const result = checkMethods(`await api.bridge("read_text_file", p); bridge(\n  "save_text_file", d);`,
    "    async def read_text_file(self, path):", []);
  expect(result.bridge).toEqual(["read_text_file", "save_text_file"]);
  expect(result.missingBridge).toEqual(["save_text_file"]);
});

test("method check doesn't read an event name as a bridge method", () => {
  const result = checkMethods(`const b = bridgeVia((m, ...a) => callable<unknown[], unknown>(m)(...a));
    addEventListener<[payload: X]>("backend_event", h);`, "", []);
  expect(result.bridge).toEqual([]);
});

test("React inspection returns bounded component names without props or hook values", () => {
  const parent: any = { type: { name: "Panel", __deckyPatch: {} }, memoizedProps: { token: "PRIVATE" } };
  parent.return = parent;
  const el = { __reactFiber$fixture: { type: "div", return: parent } };
  const result = vm.runInNewContext(`(${reactProbe})(".wowdeck-root", 12)`, { document: { querySelector: () => el } });
  expect(result.components).toEqual([{ name: "div", patched: false }, { name: "Panel", patched: true }]);
  expect(result.truncated).toBe(true);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  const shallow = vm.runInNewContext(`(${reactProbe})("x", 1)`, { document: { querySelector: () => el } });
  expect(shallow.components.length).toBe(1);
});

test("diagnostics scrub URL queries and common credential assignments", () => {
  const output = redact('failed https://example.test/?key=PRIVATE api_key="PRIVATE" Authorization: Bearer PRIVATE cookie=PRIVATE');
  expect(output).not.toContain("PRIVATE");
  expect(output).toContain("<REDACTED>");
});

test("log checkpoints survive append, rename and truncation without repeating old lines", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, renameSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const root = mkdtempSync(path.join(tmpdir(), "wowdeck-log-reader-"));
  const dir = path.join(root, "homebrew/logs/wowdeck");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "current.log");
  const query = async (options: object) => {
    const proc = Bun.spawn(["python3", `${import.meta.dir}/logs.py`, Buffer.from(JSON.stringify(options)).toString("base64")], {
      env: { ...process.env, HOME: root }, stdout: "pipe", stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(err).toBe("");
    expect(code).toBe(0);
    return JSON.parse(out);
  };
  try {
    writeFileSync(file, "old line with padding\n");
    const checkpoint = await query({ mode: "mark" });
    appendFileSync(file, "new line\n");
    expect(await query({ mode: "read", checkpoint })).toEqual(["new line"]);
    renameSync(file, path.join(dir, "previous.log"));
    writeFileSync(file, "new run\n");
    expect((await query({ mode: "read", checkpoint })).sort()).toEqual(["new line", "new run"]);
    const next = await query({ mode: "mark" });
    writeFileSync(file, "short\n");
    expect(await query({ mode: "read", checkpoint: next })).toEqual(["short"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
