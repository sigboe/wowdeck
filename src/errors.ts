/**
 * Reduces whatever a backend call rejected with to the engine's own message.
 * Decky surfaces a failed Python call as a string that can carry a Python
 * traceback, the exception class (`main.BackendError`) and the engine's
 * `[code]` prefix (see BackendError in main.py); none of that belongs in
 * front of a user.
 */
export function rawErrorText(e: unknown): string {
  let text = e instanceof Error ? e.message : String(e);
  if (/Traceback \(most recent call last\)/.test(text)) {
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    text = lines[lines.length - 1] ?? text;
  }
  text = text
    .trim()
    .replace(/^(?:Error:\s*)?(?:<class '[^']*'>|[\w.]*(?:BackendError|Exception|Error))\s*:\s*/, "")
    .replace(/^\[[a-z_]+\]\s*/, "");
  return text || "";
}

/**
 * Errors from the network or the system, said the way a person would (C06):
 * the raw text (URLs, errno codes, HTTP status) belongs in Diagnostics,
 * which records it, not in a toast.
 */
const PLAIN: [RegExp, string][] = [
  [/ENOSPC|no space left/i, "Not enough free space"],
  [/EACCES|EPERM|permission denied|read-only file system/i, "No permission to change those files"],
  [/^Request [\w.]+ timed out$|timed? ?out|timeout|AbortError/i, "That took too long. Try again"],
  [
    /fetch failed|getaddrinfo|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|Unable to connect|network|offline/i,
    "Couldn't reach the internet. Check your connection",
  ],
  [/HTTP 429/, "Too many requests right now. Try again in a minute"],
  [/HTTP 40[13]/, "The request wasn't accepted. Check the API key in Options"],
  [/HTTP 404/, "It's no longer available from its source"],
  [/HTTP 5\d\d/, "The addon source is having problems. Try again later"],
  [
    /request to \S+ failed|^(GET|POST|HEAD) \S+/i,
    "Couldn't reach the addon source. Try again later",
  ],
];

/** What to show for a failed backend call: the engine's message, in plain words, never empty. */
export function backendErrorMessage(e: unknown): string {
  const text = rawErrorText(e);
  for (const [pattern, plain] of PLAIN) {
    if (pattern.test(text)) {
      return plain;
    }
  }
  return text || "Something went wrong";
}

/** How much of an error message a toast or an inline error line shows. */
export const ERROR_TEXT_MAX = 160;

/** backendErrorMessage, cut to the one length every screen uses. */
export function errorText(e: unknown): string {
  return backendErrorMessage(e).slice(0, ERROR_TEXT_MAX);
}
