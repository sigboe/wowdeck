/**
 * The Controller layouts catalogue, engine side: controllerLayouts.catalogue
 * over the RPC. A fake net stands in for NetworkClient.getText and answers
 * with recorded manifests (fixtures/controller-layouts, all synthetic or
 * candidate-only, never production entries) or a transport failure, so no
 * test touches the network (deterministic tests, AGENTS.md).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { controllerLayoutsHandlers } from "../src/api/handlers/controllerLayouts";
import { JsonlServer } from "../src/bridge/jsonl";
import { NetworkError, ResponseTooLargeError, type RequestOptions } from "../src/wow/net/network";
import { ControllerLayoutCatalogueSource } from "../src/wow/controllerLayouts/ControllerLayoutCatalogue";
import { defaultSettings } from "../src/wow/storage/settings";

const URL_ = "https://catalogue.example/catalogue.json";
const FIXTURES = join(import.meta.dir, "fixtures", "controller-layouts");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf-8");

function makeSource(answer: string | Error) {
  const asked: { url: string; options: RequestOptions }[] = [];
  const net = {
    async getText(url: string, options: RequestOptions = {}): Promise<string> {
      asked.push({ url, options });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { source: new ControllerLayoutCatalogueSource(net, URL_), asked };
}

async function call(answer: string | Error, controllerLayoutsEnabled = true) {
  const { source, asked } = makeSource(answer);
  let response: { result?: unknown; error?: unknown } = {};
  const rpc = new JsonlServer((line) => {
    response = JSON.parse(line);
  });
  rpc.handle(controllerLayoutsHandlers({ controllerLayouts: source, store: { settings: { ...defaultSettings(), controllerLayoutsEnabled } } }));
  await rpc.handleLine(JSON.stringify({ id: 1, method: "controllerLayouts.catalogue", params: {} }));
  return { response, asked };
}

describe("controllerLayouts.catalogue", () => {
  test("the recorded two-entry catalogue answers its layouts in the maintainers' order", async () => {
    const { response } = await call(fixture("two-entries.json"));

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      state: "ready",
      layouts: [
        {
          id: "fixture-synthetic-a",
          title: "Fixture layout A",
          author: "WoWDeck fixtures",
          description: "Synthetic entry for tests. Maps A to A.",
          controllerType: "controller_neptune",
          publishedFileId: "1000000000000000001",
          offer: "available",
          revision: {
            number: 2,
            sha256: "2222222222222222222222222222222222222222222222222222222222222222",
            contentFormat: 1,
            withdrawn: false,
          },
          revisions: [
            {
              number: 1,
              sha256: "1111111111111111111111111111111111111111111111111111111111111111",
              contentFormat: 1,
              withdrawn: true,
            },
            {
              number: 2,
              sha256: "2222222222222222222222222222222222222222222222222222222222222222",
              contentFormat: 1,
              withdrawn: false,
            },
          ],
          metrics: { votesUp: 12 },
          provenance: { nominatedBy: "maintainers", reviewedBy: "sigboe" },
        },
        {
          id: "kinzo-wow-forever",
          title: "Kinzo WoW Forever",
          author: "Kinzo",
          controllerType: "controller_triton",
          publishedFileId: "3810861852",
          offer: "available",
          revision: {
            number: 61,
            sha256: "97cd0c87e6a2cd607519f9d3b2ad9ca0bb61255126e0647b01b7a67b81ed41d5",
            contentFormat: 1,
            withdrawn: false,
          },
          revisions: [
            {
              number: 61,
              sha256: "97cd0c87e6a2cd607519f9d3b2ad9ca0bb61255126e0647b01b7a67b81ed41d5",
              contentFormat: 1,
              withdrawn: false,
            },
          ],
        },
      ],
    });
  });

  test("while the source is off it answers disabled and fetches nothing", async () => {
    const { response, asked } = await call(fixture("two-entries.json"), false);

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ state: "disabled" });
    expect(asked).toEqual([]);
  });

  test("a failed request is unavailable, never an empty catalogue", async () => {
    const { response } = await call(new NetworkError("GET https://catalogue.example/catalogue.json failed: HTTP 404", 404));

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ state: "unavailable" });
  });

  test("a response past the size cap is unavailable", async () => {
    const { response } = await call(new ResponseTooLargeError(256 * 1024, URL_));

    expect(response.result).toEqual({ state: "unavailable" });
  });

  test("a catalogue with no layouts is ready and empty", async () => {
    const { response } = await call(fixture("empty.json"));

    expect(response.result).toEqual({ state: "ready", layouts: [] });
  });

  test.each([
    ["not JSON", "<html>404: Not Found</html>"],
    ["null", "null"],
    ["a list", "[]"],
    ["no schemaVersion", JSON.stringify({ layouts: [] })],
    ["no layouts list", JSON.stringify({ schemaVersion: 1, layouts: {} })],
    [
      "only invalid entries",
      JSON.stringify({ schemaVersion: 1, layouts: [{ id: "Bad Id", title: "x" }, { id: "no-revisions", revisions: [] }] }),
    ],
  ])("%s is malformed", async (_name, text) => {
    const { response } = await call(text);

    expect(response.result).toEqual({ state: "malformed" });
  });

  test("a manifest schema newer than this client is unsupported", async () => {
    const { response } = await call(fixture("future-schema.json"));

    expect(response.result).toEqual({ state: "unsupported", schemaVersion: 2 });
  });

  test("withdrawn and unreadable revisions are not offered for new application", async () => {
    const { response } = await call(fixture("withdrawn-and-unsupported.json"));
    const layouts = (response.result as { layouts: { id: string; offer: string; revision: { number: number } | null }[] })
      .layouts;

    expect(layouts.map(({ id, offer, revision }) => ({ id, offer, revision: revision?.number ?? null }))).toEqual([
      { id: "fixture-withdrawn", offer: "withdrawn", revision: null },
      { id: "fixture-future-format", offer: "unsupported", revision: null },
      // The newer revision needs a newer client; the older approved one is still offered.
      { id: "fixture-older-readable", offer: "available", revision: 1 },
    ]);
  });

  test("an invalid or duplicate entry is left out; the rest still show", async () => {
    const good = JSON.parse(fixture("two-entries.json"));
    const [a, kinzo] = good.layouts;
    const manifest = {
      schemaVersion: 1,
      layouts: [
        a,
        { ...kinzo, publishedFileId: "not-a-number" },
        { ...kinzo, revisions: [{ number: 2, sha256: "x".repeat(64), contentFormat: 1 }] },
        { ...a, title: "Duplicate of A" },
        kinzo,
      ],
    };

    const { response } = await call(JSON.stringify(manifest));

    expect((response.result as { layouts: { id: string; title: string }[] }).layouts.map((l) => [l.id, l.title])).toEqual([
      ["fixture-synthetic-a", "Fixture layout A"],
      ["kinzo-wow-forever", "Kinzo WoW Forever"],
    ]);
  });

  test("text is shown plain and capped; metrics never invent a value", async () => {
    const manifest = {
      schemaVersion: 1,
      layouts: [
        {
          id: "fixture-text",
          title: "\u202eRight\u0007 to left  title",
          author: "a".repeat(500),
          controllerType: "controller_neptune",
          publishedFileId: "1000000000000000005",
          revisions: [{ number: 1, sha256: "7".repeat(64), contentFormat: 1 }],
          metrics: { votesUp: -1, playtimeHours: "lots", subscribers: 3 },
          provenance: { "bad key": "x", reviewedBy: 5 },
        },
      ],
    };

    const { response } = await call(JSON.stringify(manifest));
    const [layout] = (response.result as { layouts: Record<string, unknown>[] }).layouts;

    expect(layout!.title).toBe("Right to left title");
    expect([...(layout!.author as string)]).toHaveLength(120);
    expect((layout!.author as string).endsWith("…")).toBe(true);
    expect(layout!.metrics).toEqual({ subscribers: 3 });
    expect(layout).not.toHaveProperty("provenance");
    expect(layout).not.toHaveProperty("description");
  });

  test("the request is bounded in size and time, at the configured catalogue URL", async () => {
    const { asked } = await call(fixture("empty.json"));

    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toBe(URL_);
    expect(asked[0]!.options.maxBytes).toBe(256 * 1024);
    expect(asked[0]!.options.timeoutMs).toBe(15_000);
  });
});
