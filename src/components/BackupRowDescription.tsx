import { STEAM } from "../steamTheme";
import type { WtfBackupInfo } from "../types";
import { backupKindLabel, backupOrigin } from "../wtfFormat";

/** A backup row's description in Manage backups and the copy modal: kind, file count or damage, origin. */
export function BackupRowDescription({ backup }: { backup: WtfBackupInfo }) {
  const origin = backupOrigin(backup);
  return (
    <>
      <div style={{ color: backup.valid ? undefined : STEAM.danger }}>
        {backupKindLabel(backup)}
        {backup.valid && backup.fileCount !== null ? ` · ${backup.fileCount} files` : ""}
        {!backup.valid && backup.invalidReason ? ` · ${backup.invalidReason}` : ""}
      </div>
      {origin && (
        <div style={{ color: origin.good ? STEAM.positive : STEAM.danger }}>{origin.text}</div>
      )}
    </>
  );
}
