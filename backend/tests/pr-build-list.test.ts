/**
 * The PR builds list, engine side: system.listPrBuilds / PrBuildList. A fake
 * net stands in for NetworkClient.getJson and answers with a recorded
 * index.json, in the shape tools/pr-build.ts documents, so no test touches
 * the network (deterministic tests, AGENTS.md).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HandlerDeps } from "../src/api/handlers/deps";
import { register } from "../src/api/handlers/system";
import { JsonlServer } from "../src/bridge/jsonl";
import { NetworkError } from "../src/wow/net/network";
import { PrBuildList } from "../src/wow/plugin/PrBuildList";

const INDEX_URL = "https://sigboe.github.io/wowdeck/index.json";
const RECORDED = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/pr-builds/index.json"), "utf8")) as {
  builds: Record<string, unknown>[];
};

function makeList(answer: unknown) {
  const asked: string[] = [];
  const net = {
    async getJson<T>(url: string): Promise<T> {
      asked.push(url);
      if (answer instanceof Error) throw answer;
      return structuredClone(answer) as T;
    },
  };
  return { list: new PrBuildList(net, INDEX_URL), asked };
}

describe("PR builds list (system.listPrBuilds)", () => {
  test("lists the published builds, newest PR first, as published", async () => {
    const { list, asked } = makeList(RECORDED);

    const builds = await list.list();

    expect(asked).toEqual([INDEX_URL]);
    expect(builds).toEqual([
      {
        number: 171,
        title: "<b>Urgent</b> fix: [click here](https://evil.example) & more",
        author: "octocat",
        version: "1.1.2-pr.171",
        headSha: "8f3c1d2e4b5a69788796a5b4c3d2e1f0a9b8c7d6",
        builtAt: "2026-11-09T18:42:07Z",
        zipSize: 73104512,
        sha256: "3b7e5a0c9d1f2e4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a",
        zipUrl: "https://sigboe.github.io/wowdeck/pr/171/WoWDeck.zip",
      },
      {
        number: 117,
        title: "Add PR builds to the channel picker",
        author: "sigboe",
        version: "1.1.2-pr.117.2",
        headSha: "0123456789abcdef0123456789abcdef01234567",
        builtAt: "2026-11-08T09:15:00Z",
        zipSize: 72998400,
        sha256: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
        zipUrl: "https://sigboe.github.io/wowdeck/pr/117/WoWDeck.zip",
      },
    ]);
  });

  test("an offline or failed fetch is null, never a throw", async () => {
    const { list } = makeList(new NetworkError("request to https://sigboe.github.io/wowdeck/index.json failed"));

    expect(await list.list()).toBeNull();
  });

  test("an empty list is an empty array: no PR builds right now", async () => {
    const { list } = makeList({ builds: [] });

    expect(await list.list()).toEqual([]);
  });

  test.each([
    ["not an object", "<html>Pages 404</html>"],
    ["null", null],
    ["no builds key", { pulls: [] }],
    ["builds not an array", { builds: { 117: {} } }],
  ])("a list that is %s is null: it couldn't load", async (_name, answer) => {
    const { list } = makeList(answer);

    expect(await list.list()).toBeNull();
  });

  /** The recorded #117 entry with some fields replaced. */
  const entry117 = (over: Record<string, unknown>) => ({ ...RECORDED.builds[1], ...over });

  test.each([
    ["a fractional PR number", { number: 117.5 }],
    ["a PR number of zero", { number: 0 }],
    ["a PR number in a string", { number: "117" }],
    ["no title", { title: undefined }],
    ["a title that is not text", { title: { html: "<b>x</b>" } }],
    ["an author that is not a GitHub login", { author: "octo cat<script>" }],
    ["a release version", { version: "1.1.2" }],
    ["a beta version", { version: "1.1.2-beta.40" }],
    ["another PR's version", { version: "1.1.2-pr.118" }],
    ["a short head commit", { headSha: "0123456" }],
    ["a build time that is not a time", { builtAt: "yesterday" }],
    ["a negative zip size", { zipSize: -1 }],
    ["an uppercase sha256", { sha256: "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90" }],
    ["a short sha256", { sha256: "a1b2c3" }],
    ["a zip over plain http", { zipUrl: "http://sigboe.github.io/wowdeck/pr/117/WoWDeck.zip" }],
    ["a zip on another host", { zipUrl: "https://evil.example/pr/117/WoWDeck.zip" }],
    ["a zip URL that is not a URL", { zipUrl: "pr/117/WoWDeck.zip" }],
  ])("an entry with %s is left out; the rest still list", async (_name, over) => {
    const { list } = makeList({ builds: [RECORDED.builds[0], entry117(over)] });

    expect((await list.list())!.map((b) => b.number)).toEqual([171]);
  });

  test("an entry that is not an object is left out", async () => {
    const { list } = makeList({ builds: [null, "117", RECORDED.builds[1]] });

    expect((await list.list())!.map((b) => b.number)).toEqual([117]);
  });

  test("a PR listed twice lists once, as first published", async () => {
    const { list } = makeList({ builds: [RECORDED.builds[1], entry117({ title: "Second copy" })] });

    expect((await list.list())!.map((b) => b.title)).toEqual(["Add PR builds to the channel picker"]);
  });

  test("fields the list does not define are not passed on", async () => {
    const { list } = makeList({ builds: [entry117({ installScript: "rm -rf ~", __proto__: { x: 1 } })] });

    expect(Object.keys((await list.list())![0]!).sort()).toEqual(
      ["author", "builtAt", "headSha", "number", "sha256", "title", "version", "zipSize", "zipUrl"],
    );
  });

  test("a title's control and text-direction characters are dropped, its markup kept as text", async () => {
    const { list } = makeList({ builds: [entry117({ title: "Fix‮gnp.exe\u0007 <i>now</i>\n" })] });

    expect((await list.list())![0]!.title).toBe("Fixgnp.exe <i>now</i>");
  });
});

describe("system.listPrBuilds over the RPC", () => {
  async function callWith(answer: unknown) {
    let response: { result?: unknown; error?: unknown } = {};
    const rpc = new JsonlServer((line) => {
      response = JSON.parse(line);
    });
    register(rpc, { prBuilds: makeList(answer).list } as unknown as HandlerDeps);
    await rpc.handleLine(JSON.stringify({ id: 1, method: "system.listPrBuilds" }));
    return response;
  }

  test("answers what the modal shows; the zip and its checksum stay in the engine", async () => {
    const response = await callWith(RECORDED);

    expect(response.result).toEqual({
      builds: [
        {
          number: 171,
          title: "<b>Urgent</b> fix: [click here](https://evil.example) & more",
          author: "octocat",
          version: "1.1.2-pr.171",
          headSha: "8f3c1d2e4b5a69788796a5b4c3d2e1f0a9b8c7d6",
          builtAt: "2026-11-09T18:42:07Z",
          zipSize: 73104512,
        },
        {
          number: 117,
          title: "Add PR builds to the channel picker",
          author: "sigboe",
          version: "1.1.2-pr.117.2",
          headSha: "0123456789abcdef0123456789abcdef01234567",
          builtAt: "2026-11-08T09:15:00Z",
          zipSize: 72998400,
        },
      ],
    });
  });

  test("a list that couldn't load answers null builds, not an RPC error", async () => {
    const response = await callWith(new NetworkError("offline"));

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ builds: null });
  });
});
