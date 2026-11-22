/**
 * The PR builds list, engine side: system.listPrBuilds / PrBuildList. A fake
 * net stands in for NetworkClient.getJson and answers with the list the PR
 * build tool itself planned (fixtures/pr-builds/list.ts runs the tool), so
 * no test touches the network (deterministic tests, AGENTS.md) and the
 * reader always meets the writer's output.
 */

import { describe, expect, test } from "bun:test";
import { subset } from "./helpers/subset";
import { systemHandlers } from "../src/api/handlers/system";
import { JsonlServer } from "../src/bridge/jsonl";
import { NetworkError } from "../src/wow/net/network";
import { PrBuildList } from "../src/wow/plugin/PrBuildList";
import { planPublish, PR_BUILD_LABEL, type PrBuildIndex, type PrState, type PublishedPrBuild } from "../../tools/pr-build";
import { LISTED } from "./fixtures/pr-builds/list";

const INDEX_URL = "https://sigboe.github.io/wowdeck/index.json";

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
    const { list, asked } = makeList(LISTED);

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

  /** The planned #117 entry with some fields replaced. */
  const entry117 = (over: Record<string, unknown>) => ({ ...LISTED.builds[1], ...over });

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
    const { list } = makeList({ builds: [LISTED.builds[0], entry117(over)] });

    expect((await list.list())!.map((b) => b.number)).toEqual([171]);
  });

  test("an entry that is not an object is left out", async () => {
    const { list } = makeList({ builds: [null, "117", LISTED.builds[1]] });

    expect((await list.list())!.map((b) => b.number)).toEqual([117]);
  });

  test("a PR listed twice lists once, as first published", async () => {
    const { list } = makeList({ builds: [LISTED.builds[1], entry117({ title: "Second copy" })] });

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

describe("the writer's plan, read by the engine", () => {
  /** Every listed PR, open and still at the head its build was made from. */
  const openAtTheirHeads = (index: PrBuildIndex): PrState[] =>
    index.builds.map((b) => ({ number: b.number, state: "open", labels: [PR_BUILD_LABEL], headSha: b.headSha }));

  test("every build the PR build tool plans to publish comes back through the parser", async () => {
    const fresh: PublishedPrBuild = {
      number: 210,
      title: "Fresh PR",
      author: "octocat",
      version: "1.1.2-pr.210",
      headSha: "9f3c1d2e4b5a69788796a5b4c3d2e1f0a9b8c7d6",
      builtAt: "2026-11-10T07:30:00Z",
      zipSize: 73000000,
      sha256: "ab".repeat(32),
      zipUrl: "https://sigboe.github.io/wowdeck/pr/210/WoWDeck.zip",
    };
    const plan = planPublish(LISTED, {
      pr: 210,
      action: "build",
      build: fresh,
      prs: [...openAtTheirHeads(LISTED), { number: 210, state: "open", labels: [PR_BUILD_LABEL], headSha: fresh.headSha }],
    });
    // What the workflow writes to Pages: the plan's index, as JSON.
    const { list } = makeList(JSON.parse(JSON.stringify(plan.index)));

    const builds = await list.list();

    expect(builds?.map((b) => b.number)).toEqual([210, 171, 117]);
    expect(builds?.find((b) => b.number === 210)).toEqual(fresh);
  });
});

describe("system.listPrBuilds over the RPC", () => {
  async function callWith(answer: unknown) {
    let response: { result?: unknown; error?: unknown } = {};
    const rpc = new JsonlServer((line) => {
      response = JSON.parse(line);
    });
    rpc.handle(systemHandlers(subset({ prBuilds: makeList(answer).list })));
    await rpc.handleLine(JSON.stringify({ id: 1, method: "system.listPrBuilds" }));
    return response;
  }

  test("answers what the modal shows; the zip and its checksum stay in the engine", async () => {
    const response = await callWith(LISTED);

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
