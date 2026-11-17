/** Engine-owned approved-content jobs. Native Steam access remains browser-side. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ControllerLayoutPreviewJob } from "../../api/contracts";
import type { ControllerLayoutCatalogueSource } from "./ControllerLayoutCatalogue";
import type { NetworkClient } from "../net/network";

const MAX_BYTES = 2 * 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export class ControllerLayoutPreviews {
  private jobs = new Map<string, { value: ControllerLayoutPreviewJob; done: Promise<void> }>();
  private paths = new Map<string, string>();
  private requests = new Map<string, { layoutId: string; revision: number; accountId: number }>();
  constructor(
    private deps: {
      catalogue: Pick<ControllerLayoutCatalogueSource, "read">;
      net: Pick<NetworkClient, "send">;
      homeDir: string;
    },
  ) {}

  start(params: { layoutId: string; revision: number; accountId: number }): { jobId: string } {
    if ([...this.jobs.values()].some((j) => j.value.state === "preparing"))
      throw Error("Couldn't prepare another preview. Wait for the current one.");
    // Keep status bounded; a newer operation supersedes completed staging jobs.
    this.jobs.clear();
    this.requests.clear();
    const jobId = randomUUID();
    const job = {
      value: { state: "preparing" } as ControllerLayoutPreviewJob,
      done: Promise.resolve(),
    };
    this.jobs.set(jobId, job);
    this.requests.set(jobId, params);
    job.done = this.prepare(params)
      .then((preview) => {
        job.value = { state: "ready", preview };
      })
      .catch((error) => {
        job.value = {
          state: "error",
          message:
            error instanceof PreviewError
              ? error.message
              : "Couldn't prepare the layout preview. Try again.",
        };
      });
    return { jobId };
  }
  status(jobId: string): ControllerLayoutPreviewJob {
    return (
      this.jobs.get(jobId)?.value ?? {
        state: "error",
        message: "Couldn't find this preview. Choose the layout again.",
      }
    );
  }
  /** Wait for this preparation without polling, also useful to embedding callers. */
  async settled(jobId: string): Promise<void> {
    await this.jobs.get(jobId)?.done;
  }

  /** Fresh catalogue authority and hash-checked disk bytes, never browser-supplied approval. */
  async authorize(jobId: string, stagedOnly = false) {
    const request = this.requests.get(jobId);
    const status = this.status(jobId);
    if (!request || status.state !== "ready") throw Error("Couldn't validate this layout preview.");
    const catalogue = stagedOnly ? undefined : await this.deps.catalogue.read();
    const layout = catalogue?.state === "ready" ? catalogue.layouts.find(l => l.id === request.layoutId) : undefined;
    const revision = layout?.revision;
    if (!stagedOnly && (!revision || revision.withdrawn || revision.number !== request.revision ||
      layout?.publishedFileId !== status.preview.provenance?.publishedFileId ||
      revision.sha256 !== status.preview.sha256 || revision.contentFormat !== 1 ||
      JSON.stringify(revision.previewMappings) !== JSON.stringify(status.preview.mappings)))
      throw Error("Couldn't validate this revision. Refresh the layouts list.");
    const path = this.paths.get(status.preview.sha256);
    if (!path || digest(await Bun.file(path).bytes()) !== status.preview.sha256)
      throw Error("Couldn't validate the approved layout bytes.");
    return status.preview;
  }

  private async prepare({
    layoutId,
    revision,
    accountId,
  }: {
    layoutId: string;
    revision: number;
    accountId: number;
  }) {
    if (!Number.isSafeInteger(accountId) || accountId < 1 || accountId > 0xffffffff)
      throw new PreviewError("Couldn't establish the Steam account.");
    const catalogue = await this.deps.catalogue.read();
    const layout =
      catalogue.state === "ready" ? catalogue.layouts.find((l) => l.id === layoutId) : undefined;
    const approved = layout?.revision;
    if (
      !layout ||
      !approved ||
      approved.number !== revision ||
      approved.withdrawn ||
      approved.contentFormat !== 1
    )
      throw new PreviewError("Couldn't preview this revision. Refresh the layouts list.");
    if (!approved.previewMappings || Object.keys(approved.previewMappings).length === 0)
      throw new PreviewError(
        "Couldn't preview this revision. Its native mappings haven't been reviewed yet.",
      );
    const metadata = await this.deps.net.send(
      "POST",
      "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
      {
        body: new URLSearchParams({
          itemcount: "1",
          "publishedfileids[0]": layout.publishedFileId,
        }).toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        maxBytes: 256 * 1024,
        timeoutMs: 15000,
        retries: 0,
      },
    );
    const detail = metadata.json<{
      response?: {
        publishedfiledetails?: { result: number; publishedfileid: string; file_url: string }[];
      };
    }>().response?.publishedfiledetails?.[0];
    if (!metadata.ok || detail?.result !== 1 || detail.publishedfileid !== layout.publishedFileId)
      throw new PreviewError("Couldn't find the approved layout content.");
    const url = new URL(detail.file_url);
    if (
      url.protocol !== "https:" ||
      !/^(?:[a-z0-9-]+\.)*(?:steamusercontent\.com|steamstatic\.com)$/.test(url.hostname) ||
      url.username ||
      url.password
    )
      throw new PreviewError("Couldn't verify the layout's content source.");
    const content = await this.deps.net.send("GET", url.href, {
      maxBytes: MAX_BYTES,
      timeoutMs: 15000,
      redirect: "error",
      retries: 0,
    });
    if (!content.ok || digest(content.bytes) !== approved.sha256)
      throw new PreviewError(
        "Couldn't download the approved revision. The author's current content may have changed.",
      );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content.bytes);
    if (
      !/^\s*"controller_mappings"\s*\{/.test(text) ||
      !text.includes(`"${layout.controllerType}"`)
    )
      throw new PreviewError("Couldn't read the approved layout content.");
    const roots = new Set<string>();
    for (const base of [".local/share/Steam", ".steam/steam"]) {
      try {
        roots.add(
          await realpath(
            join(
              this.deps.homeDir,
              base,
              "steamapps/common/Steam Controller Configs",
              String(accountId),
              "config",
            ),
          ),
        );
      } catch {
        /* Not this Steam installation. */
      }
    }
    if (roots.size !== 1)
      throw new PreviewError("Couldn't establish this account's controller layout folder.");
    const root = [...roots][0]!;
    const dir = join(root, "wowdeck-approved");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await realpath(dir)) !== dir) throw new PreviewError("Couldn't safely stage this layout.");
    const path = join(dir, `${approved.sha256}.vdf`);
    const temporary = join(dir, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content.bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
      if (digest(await Bun.file(path).bytes()) !== approved.sha256)
        throw new PreviewError("Couldn't verify the staged layout.");
    } finally {
      await rm(temporary, { force: true });
    }
    this.paths.set(approved.sha256, path);
    return {
      provenance: { layoutId, revision, publishedFileId: layout.publishedFileId },
      url: `usercloud://wowdeck-approved/${approved.sha256}`,
      sha256: approved.sha256,
      title: layout.title,
      accountId,
      mappings: approved.previewMappings,
    };
  }
}
class PreviewError extends Error {}
