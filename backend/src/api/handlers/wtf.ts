/** RPC handlers: WTF backup and restore (docs/wtf-backup.md): create/restore run as jobs reporting through wtf.progress / wtf.completed. */

import type { HandlerTable } from "../../bridge/jsonl";
import { WtfBackupError } from "../../wow/wtf/errors";
import type { InstallationService } from "../../wow/installation/InstallationService";
import type { WtfBackupService } from "../../wow/wtf/WtfBackupService";
import type { WtfJobRunner, WtfJobTarget } from "../../wow/wtf/WtfJobRunner";

/** What the WTF handlers use. */
export interface WtfDeps {
  wtfService: Pick<WtfBackupService, "deleteBackup" | "gameStatus" | "importBackup" | "listBackups" | "listCopySources" | "measure">;
  wtfJobs: Pick<WtfJobRunner, "cancel" | "current" | "startCopy" | "startCopyCurrent" | "startCreate" | "startRestore">;
  /** The WTF job target for an installation. */
  wtfJobTarget: (installationId: string) => WtfJobTarget;
  installationService: Pick<InstallationService, "list">;
}

export function wtfHandlers({ wtfService, wtfJobs, wtfJobTarget, installationService }: WtfDeps) {
  return {
    "wtf.list": async (params) => {
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
    },

    // create/restore return immediately: the work runs as a job (one RPC at a time is served and the bridge
    // times out after 120 s), reporting through wtf.progress / wtf.completed events.
    "wtf.create": async (params) => wtfJobs.startCreate(wtfJobTarget(params.installationId)),

    "wtf.restore": async (params) =>
      wtfJobs.startRestore(wtfJobTarget(params.installationId), params.fileName, {
        acceptUnknownFlavor: params.acceptUnknownFlavor === true,
        // Passed as given: absent means the service default (off for a restore, on for a copy).
        keepCurrentConfig: params.keepCurrentConfig,
      }),

    "wtf.copySources": async (params) => {
      const target = wtfJobTarget(params.installationId);
      const installed = installationService.list().map((i) => wtfJobTarget(i.id));
      return wtfService.listCopySources(target, installed);
    },

    "wtf.copy": async (params) => {
      const target = wtfJobTarget(params.installationId);
      const { keepCurrentConfig } = params;
      if ("fileName" in params) {
        return wtfJobs.startCopy(target, params.sourceFlavor, params.fileName, {
          keepCurrentConfig,
          acceptUnknownFlavor: params.acceptUnknownFlavor === true,
        });
      }
      // Current settings: the named installation must be the named version.
      const source = params.sourceInstallationId ? wtfJobTarget(params.sourceInstallationId) : null;
      if (!source || source.flavor !== params.sourceFlavor) {
        throw new WtfBackupError("not_found", "That WoW version isn't installed any more.");
      }
      return wtfJobs.startCopyCurrent(target, source, { keepCurrentConfig });
    },

    "wtf.delete": async (params) => {
      // Refused while a job runs: the service takes the job lock.
      await wtfService.deleteBackup(wtfJobTarget(params.installationId), params.fileName);
      return { fileName: params.fileName };
    },

    "wtf.import": async (params) => {
      // Refused while a job runs: the service takes the job lock.
      return wtfService.importBackup(wtfJobTarget(params.installationId), params.path);
    },

    "wtf.cancel": async (params) => wtfJobs.cancel(params.jobId),
  } satisfies Partial<HandlerTable>;
}
