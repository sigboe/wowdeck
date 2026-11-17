import { expect, test } from "bun:test";
import { ControllerLayoutOperations } from "../src/wow/controllerLayouts/ControllerLayoutOperations";
import { ControllerLayoutPreviews } from "../src/wow/controllerLayouts/ControllerLayoutPreviews";

test("a revision without published mappings still prepares a native preview", async () => {
  let downloads = 0;
  const previews = new ControllerLayoutPreviews({
    catalogue: {
      read: async () => ({
        state: "ready",
        layouts: [
          {
            id: "approved",
            revision: { number: 1, withdrawn: false, contentFormat: 1, sha256: "a".repeat(64) },
          },
        ],
      }),
    } as never,
    net: {
      send: async () => {
        downloads++;
        throw Error("offline");
      },
    } as never,
    homeDir: "/unused",
  });
  const { jobId } = previews.start({ layoutId: "approved", revision: 1, accountId: 123 });
  await previews.settled(jobId);
  // The browser checks the decode against Steam's defaults instead (#261).
  expect(downloads).toBe(1);
  expect(previews.status(jobId).state).toBe("error");
});

import { afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controllerLayoutsHandlers } from "../src/api/handlers/controllerLayouts";
import { parseCatalogue } from "../src/wow/controllerLayouts/ControllerLayoutCatalogue";
const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

async function engine(content?: Uint8Array, metadata?: string) {
  const home = await mkdtemp(join(tmpdir(), "preview-267-"));
  homes.push(home);
  await mkdir(
    join(home, ".local/share/Steam/steamapps/common/Steam Controller Configs/123/config"),
    { recursive: true },
  );
  const bytes =
    content ??
    (await Bun.file(join(import.meta.dir, "fixtures/controller-layouts/approved.vdf")).bytes());
  const detail =
    metadata ??
    (await Bun.file(
      join(import.meta.dir, "fixtures/controller-layouts/published-detail.json"),
    ).text());
  const catalogue = {
    read: async () =>
      parseCatalogue(
        JSON.stringify({
          schemaVersion: 1,
          layouts: [
            {
              id: "approved",
              title: "Synthetic approved layout",
              author: "Fixture",
              controllerType: "controller_neptune",
              publishedFileId: "3810861852",
              revisions: [
                {
                  number: 1,
                  contentFormat: 1,
                  sha256: "594bf63d6a335accef2e6a577d5873240aa43c257c4cbec5732e52dea3ed5448",
                  previewMappings: { "4": "b".repeat(64) },
                },
              ],
            },
          ],
        }),
      ),
  };
  const previews = new ControllerLayoutPreviews({
    homeDir: home,
    catalogue,
    net: {
      send: async (method: string) => ({
        ok: true,
        status: 200,
        bytes: method === "POST" ? new TextEncoder().encode(detail) : bytes,
        json: () => JSON.parse(detail),
      }),
    } as never,
  });
  const operations = new ControllerLayoutOperations(join(home, "operations"), previews);
  const rpc = controllerLayoutsHandlers({
    controllerLayouts: catalogue,
    controllerLayoutOperations: operations,
    controllerLayoutPreviews: previews,
    store: { settings: { controllerLayoutsEnabled: true } } as never,
  });
  return { home, rpc, settleOperation: () => operations.settled(), settle: (jobId: string) => previews.settled(jobId) };
}

test("typed preview jobs stage exact approved bytes in the account's separate namespace", async () => {
  const app = await engine();
  const job = await app.rpc["controllerLayouts.preparePreview"]({
    layoutId: "approved",
    revision: 1,
    accountId: 123,
  });
  await app.settle(job.jobId);
  const result = await app.rpc["controllerLayouts.previewStatus"](job);
  expect(result.state).toBe("ready");
  if (result.state !== "ready") throw Error(JSON.stringify(result));
  expect(result.preview.url).toBe(
    "usercloud://wowdeck-approved/594bf63d6a335accef2e6a577d5873240aa43c257c4cbec5732e52dea3ed5448",
  );
  expect(
    await readFile(
      join(
        app.home,
        ".local/share/Steam/steamapps/common/Steam Controller Configs/123/config/wowdeck-approved/594bf63d6a335accef2e6a577d5873240aa43c257c4cbec5732e52dea3ed5448.vdf",
      ),
    ),
  ).toEqual(await readFile(join(import.meta.dir, "fixtures/controller-layouts/approved.vdf")));
});

test("a mutable source update cannot replace an approved revision", async () => {
  const app = await engine(new TextEncoder().encode('"controller_mappings" { "title" "Changed" }'));
  const job = await app.rpc["controllerLayouts.preparePreview"]({
    layoutId: "approved",
    revision: 1,
    accountId: 123,
  });
  await app.settle(job.jobId);
  expect(await app.rpc["controllerLayouts.previewStatus"](job)).toEqual({
    state: "error",
    message:
      "Couldn't download the approved revision. The author's current content may have changed.",
  });
});

test("untrusted content sources are refused", async () => {
  const app = await engine(
    undefined,
    '{"response":{"publishedfiledetails":[{"result":1,"publishedfileid":"3810861852","file_url":"file:///etc/passwd"}]}}',
  );
  const job = await app.rpc["controllerLayouts.preparePreview"]({
    layoutId: "approved",
    revision: 1,
    accountId: 123,
  });
  await app.settle(job.jobId);
  expect((await app.rpc["controllerLayouts.previewStatus"](job)).state).toBe("error");
});


test("changed staged bytes are refused through operation RPC before preservation", async () => {
  const app = await engine();
  const job = await app.rpc["controllerLayouts.preparePreview"]({ layoutId: "approved", revision: 1, accountId: 123 });
  await app.settle(job.jobId);
  const path = join(app.home, ".local/share/Steam/steamapps/common/Steam Controller Configs/123/config/wowdeck-approved/594bf63d6a335accef2e6a577d5873240aa43c257c4cbec5732e52dea3ed5448.vdf");
  await Bun.write(path, "corrupt or personally changed bytes");
  const operation = await app.rpc["controllerLayouts.beginOperation"]({ nativeOwner: "11111111-1111-4111-8111-111111111111", previewJobId: job.jobId, context: {
    installationId: "retail", target: 42, accountId: 123, controllerIndex: 15, controllerType: 4,
    controllerIdentity: "controller-a", selection: "inherited", scope: { state: "established", identity: "all controllers", targets: [{ appId: 42, name: "WoW" }] },
  } });
  expect(operation.phase).toBe("validating");
  await app.settleOperation();
  expect(await app.rpc["controllerLayouts.operationStatus"]({})).toMatchObject({ phase: "failed" });
});
