/**
 * Friendly messages for Install from URL's common, expected failure
 * codes — an unmapped case should never surface a raw exception string
 * like "Python Exception" to the user. The backend returns these as a
 * structured `{ code, message }` result rather than a thrown RPC error
 * specifically so this mapping has something reliable to key off —
 * see backend/src/api/contracts.ts's comment on `addons.resolveUrlImport`.
 *
 * Codes are this project's own `ProviderError` codes (GitHubProvider),
 * plus the bridge's generic ones (`invalid_request`/`not_found`, from
 * `errorCodeFor` in backend/src/bridge/jsonl.ts) — not WowUp's; WowUp's own error
 * types are Angular/Electron-specific and don't carry over to this wire
 * protocol. An unrecognized code falls back to the backend's own
 * message, which is already a clear sentence, not a raw exception dump.
 */
const FRIENDLY_MESSAGES: Record<string, string> = {
  github_no_compatible_release: "This repository has no release for your WoW version.",
  github_rate_limited:
    "GitHub is limiting requests right now. Try again later, or add a personal access token in Options.",
  github_forbidden: "This repository can't be opened. Private repositories aren't supported.",
  source_removed: "This addon is no longer available from its source.",
};

export function friendlyUrlImportError(error: { code: string; message: string }): string {
  return FRIENDLY_MESSAGES[error.code] ?? error.message;
}
