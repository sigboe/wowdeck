/** Domain error types for the addon engine. */

import { PROVIDER_ID, providerDisplayName } from "../api/providers";

/**
 * What a user reads when something is not found (copy rule C06: no ids, no
 * internal names). `what` and `id` stay on the error for logs and tests.
 */
const NOT_FOUND_TEXT: Record<string, string> = {
  addon: "That addon isn't in your list any more. Refresh and try again",
  installation: "That WoW installation isn't available. Check Options",
  "addon on provider": "This addon is no longer available from its source",
  "addon for url": "No addon was found at that address",
  provider: "That addon source isn't available",
  "provider for addon": "This addon's source isn't available",
  "addon folders for": "This addon's folders weren't found",
};

export class NotFoundError extends Error {
  constructor(
    public what: string,
    public id: string,
  ) {
    super(NOT_FOUND_TEXT[what] ?? "That wasn't found");
    this.name = "NotFoundError";
  }
}

/**
 * A system error as a user sentence (C06): the two cases a person can act on
 * keep their meaning, everything else gets `fallback`. Logs the raw error.
 */
export function plainSystemError(err: unknown, fallback: string, context: string): string {
  const raw = String(err);
  console.error(`[${context}] ${raw}`);
  if (/ENOSPC|no space left/i.test(raw)) {
    return "Not enough free space";
  }
  if (/EACCES|EPERM|read-only file system/i.test(raw)) {
    return "No permission to change the AddOns folder";
  }
  return fallback;
}

export { providerDisplayName };

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class FileSystemError extends Error {
  constructor(message: string, public path?: string) {
    super(message);
    this.name = "FileSystemError";
  }
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public code = "provider_error",
  ) {
    // No "[Curse]" prefix: this text reaches users (C05, C06); `provider`
    // stays on the error for logs.
    super(message);
    this.name = "ProviderError";
  }
}

export class InstallError extends Error {
  constructor(message: string, public addonId?: string) {
    super(message);
    this.name = "InstallError";
  }
}

/**
 * The stable wire codes for a local archive that can't be previewed or
 * installed (Manual Install's From a file; see `addons.inspectArchive`).
 */
export type ArchiveErrorCode =
  | "archive_not_supported"
  | "archive_no_addons"
  | "archive_unreadable"
  | "archive_extraction_failed";

/**
 * A local archive file the engine refused (project-owned, like the flow
 * it serves): a ProviderError of the File source whose code is the
 * stable envelope code, so `errorCodeFor` needs no case of its own.
 */
export class ArchiveError extends ProviderError {
  constructor(message: string, code: ArchiveErrorCode) {
    super(PROVIDER_ID.File, message, code);
    this.name = "ArchiveError";
  }
}
