import { describe, expect, test } from "bun:test";
import { EngineError, JsonlServer, settle } from "../src/bridge/jsonl";
import { ProviderError, ValidationError } from "../src/wow/errors";

function makeServer() {
  const lines: string[] = [];
  const server = new JsonlServer((line) => lines.push(line));
  return { server, lines };
}

describe("JsonlServer", () => {
  test("responds to a handled method with its result", async () => {
    const { server, lines } = makeServer();
    server.on("system.getStatus", async () => ({
      backendVersion: "test",
      protocolVersion: 1,
      pid: 123,
    }));
    await server.handleLine('{"id":1,"method":"system.getStatus","params":{}}');
    expect(lines).toEqual(['{"id":1,"result":{"backendVersion":"test","protocolVersion":1,"pid":123}}']);
  });

  test("returns method_not_found for unknown methods", async () => {
    const { server, lines } = makeServer();
    await server.handleLine('{"id":2,"method":"nope","params":{}}');
    const msg = JSON.parse(lines[0]!);
    expect(msg.id).toBe(2);
    expect(msg.error.code).toBe("method_not_found");
  });

  test("maps EngineError to error responses", async () => {
    const { server, lines } = makeServer();
    server.on("addons.list", async () => {
      throw new EngineError("no_installation", "none selected");
    });
    await server.handleLine('{"id":3,"method":"addons.list","params":{}}');
    const msg = JSON.parse(lines[0]!);
    expect(msg.error.code).toBe("no_installation");
    expect(msg.error.message).toBe("none selected");
  });

  test("maps unexpected errors to internal_error", async () => {
    const { server, lines } = makeServer();
    server.on("addons.list", (async () => {
      throw new Error("boom");
    }) as never);
    await server.handleLine('{"id":4,"method":"addons.list","params":{}}');
    const msg = JSON.parse(lines[0]!);
    expect(msg.error.code).toBe("internal_error");
    expect(msg.error.message).toBe("boom");
  });

  test("ignores invalid JSON without throwing", async () => {
    const { server, lines } = makeServer();
    await server.handleLine("not json at all");
    expect(lines).toEqual([]);
  });

  test("ignores non-request messages", async () => {
    const { server, lines } = makeServer();
    await server.handleLine('{"event":"addons.changed","params":{}}');
    expect(lines).toEqual([]);
  });

  test("emits events as JSONL lines", () => {
    const { server, lines } = makeServer();
    server.emit("addons.changed", { addonIds: ["a"] });
    expect(lines).toHaveLength(1);
    const msg = JSON.parse(lines[0]!);
    expect(msg.event).toBe("addons.changed");
  });

  test("missing params default to empty object", async () => {
    const { server, lines } = makeServer();
    server.on("system.getStatus", async (params) => {
      expect(params).toEqual({});
      return { backendVersion: "test", protocolVersion: 1, pid: 1 };
    });
    await server.handleLine('{"id":9,"method":"system.getStatus"}');
    expect(JSON.parse(lines[0]!).result.backendVersion).toBe("test");
  });

  test("a slow request does not hold back the ones behind it", async () => {
    const { server, lines } = makeServer();
    let finishSlow!: () => void;
    server.on("addons.install", () => new Promise((resolve) => (finishSlow = () => resolve({} as never))));
    server.on("system.getStatus", async () => ({ backendVersion: "t", protocolVersion: 1, pid: 1 }));
    async function* input() {
      yield new TextEncoder().encode('{"id":1,"method":"addons.install","params":{}}\n');
      yield new TextEncoder().encode('{"id":2,"method":"system.getStatus","params":{}}\n');
    }
    const running = server.run(input());
    await new Promise((r) => setTimeout(r, 10));
    expect(lines.map((l) => JSON.parse(l).id)).toEqual([2]);
    finishSlow();
    await running;
    expect(lines.map((l) => JSON.parse(l).id)).toEqual([2, 1]);
  });

  test("a request split across reads is handled once, whole", async () => {
    const { server, lines } = makeServer();
    server.on("system.getStatus", async () => ({ backendVersion: "t", protocolVersion: 1, pid: 1 }));
    const bytes = new TextEncoder().encode('{"id":7,"method":"system.getStatus","params":{"x":"é"}}\n{"id":8,"method":"system.getStatus"}');
    async function* input() {
      // Split inside the line and inside the two-byte "é".
      const cut = bytes.indexOf(0xc3) + 1;
      yield bytes.slice(0, 10);
      yield bytes.slice(10, cut);
      yield bytes.slice(cut);
    }
    await server.run(input());
    expect(lines.map((l) => JSON.parse(l).id)).toEqual([7, 8]);
  });
});

// The never-throws methods (addons.resolveUrlImport, addons.inspectArchive):
// an expected failure is part of the answer, not an RPC error.
describe("settle", () => {
  test("a result comes back with no error", async () => {
    expect(await settle(async () => 42)).toEqual({ result: 42, error: null });
  });

  test("a provider failure comes back as its own code and message", async () => {
    const failing = async () => {
      throw new ProviderError("GitHub", "No release for this game version", "github_no_compatible_release");
    };
    expect(await settle(failing)).toEqual({
      result: null,
      error: { code: "github_no_compatible_release", message: "No release for this game version" },
    });
  });

  test("a failure before the work starts is settled too", async () => {
    const failing = () => {
      throw new ValidationError("No installation selected");
    };
    expect(await settle(failing)).toEqual({
      result: null,
      error: { code: "invalid_request", message: "No installation selected" },
    });
  });
});
