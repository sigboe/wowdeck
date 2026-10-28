/** RPC handlers: WTF backup and restore (docs/wtf-backup.md): create/restore run as jobs reporting through wtf.progress / wtf.completed. */

import type { JsonlServer } from "../../bridge/jsonl";
import { WtfBackupError } from "../../wow/wtf/errors";
import type { HandlerDeps } from "./deps";

export function register(server: JsonlServer, { wtfService, wtfJobs, wtfJobTarget, installationService }: HandlerDeps): void {
  server.on("wtf.list", async (params) => {
    const target = wtfJobTarget(params.installationId);
    const [listed, measured, gameRunning] = await Promise.all([
      wtfService.listBackups(target),
      wtfService.measure(target),
      wtfService.gameStatus(),
    ]);
    return {
      wtfExists: measured.exists,
      backupDir: listed.backupDir,
      dirAvailable: listed.dirAvailable,
      backups: listed.backups,
      totalBackupBytes: listed.totalBackupBytes,
      gameRunning,
      job: wtfJobs.current(),
    };
  });

  server.on("wtf.measure", async (params) => wtfService.measure(wtfJobTarget(params.installationId)));

  // create/restore return immediately: the work runs as a job (one RPC at a time is served and the bridge
  // times out after 120 s), reporting through wtf.progress / wtf.completed events.
  server.on("wtf.create", async (params) => wtfJobs.startCreate(wtfJobTarget(params.installationId)));

  server.on("wtf.restore", async (params) =>
    wtfJobs.startRestore(wtfJobTarget(params.installationId), params.fileName, {
      acceptUnknownFlavor: params.acceptUnknownFlavor === true,
      keepCurrentConfig: params.keepCurrentConfig === true,
    }),
  );

  server.on("wtf.copySources", async (params) => {
    const target = wtfJobTarget(params.installationId);
    const installed = installationService.list().map((i) => wtfJobTarget(i.id));
    return wtfService.listCopySources(target, installed);
  });

  server.on("wtf.copy", async (params) => {
    const target = wtfJobTarget(params.installationId);
    const keepCurrentConfig = params.keepCurrentConfig !== false;
    if ("fileName" in params) {
      return wtfJobs.startCopy(target, params.sourceFlavor, params.fileName, {
        keepCurrentConfig,
        acceptUnknownFlavor: params.acceptUnknownFlavor === true,
      });
    }
    // Current settings: the named installation must be the named version.
    // Never an empty id: require() would fall back to the selected installation.
    const source = params.sourceInstallationId ? wtfJobTarget(params.sourceInstallationId) : null;
    if (!source || source.flavor !== params.sourceFlavor) {
      throw new WtfBackupError("not_found", "That WoW version isn't installed any more.");
    }
    return wtfJobs.startCopyCurrent(target, source, { keepCurrentConfig });
  });

  server.on("wtf.delete", async (params) => {
    // Refused while a job runs: the service takes the job lock.
    await wtfService.deleteBackup(wtfJobTarget(params.installationId), params.fileName);
    return { fileName: params.fileName };
  });

  server.on("wtf.import", async (params) => {
    // Refused while a job runs: the service takes the job lock.
    return wtfService.importBackup(wtfJobTarget(params.installationId), params.path);
  });

  server.on("wtf.cancel", async (params) => wtfJobs.cancel(params.jobId));
}
