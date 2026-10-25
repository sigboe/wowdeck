/**
 * Friendly messages for Manual Install's From a file — the expected
 * failures of a picked archive, mapped beside the URL import's mapping
 * (urlImportErrors.ts) from the same never-throws envelope
 * (`addons.inspectArchive`; see backend/src/api/contracts.ts).
 *
 * An unmapped code falls back to the backend's own message, which is
 * already a clear sentence, never a raw exception dump.
 */
const FRIENDLY_MESSAGES: Record<string, string> = {
  archive_not_supported: "That file isn't a zip, RAR or 7z archive.",
  archive_no_addons:
    "That archive holds no installable WoW addon folders. Every folder needs a .toc file inside.",
  archive_unreadable: "That archive can't be read. Was it moved, renamed or deleted?",
  archive_extraction_failed:
    "That archive couldn't be unpacked. It may be damaged, password-protected, or need a tool this Deck doesn't have.",
  invalid_request: "Pick an archive file first.",
};

export function friendlyArchiveError(error: { code: string; message: string }): string {
  return FRIENDLY_MESSAGES[error.code] ?? error.message;
}
