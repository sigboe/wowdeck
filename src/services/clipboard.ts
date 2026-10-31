/**
 * Copy to clipboard from the frontend, the way Steam's own UI does it
 * (UI guide G8): `navigator.clipboard` is unavailable in Steam's webview, but
 * `execCommand("copy")` on a selected textarea works.
 */

export interface CopyResult {
  ok: boolean;
  message: string;
}

/**
 * The QAM and modals render in Steam's window, not the plugin's, so the copy
 * runs against the top window's document when there is one.
 */
function hostDocument(): Document {
  try {
    return window.top?.document ?? window.document;
  } catch {
    // A cross-origin top refuses access to its document.
    return window.document;
  }
}

/** Steam calls this before copying, to mark the copy as user-initiated. */
function notifyUserActivation(): void {
  const steam = (window as { SteamClient?: { Browser?: { NotifyUserActivation?: () => void } } })
    .SteamClient;
  steam?.Browser?.NotifyUserActivation?.();
}

/**
 * Puts `text` on the clipboard. Never reads the clipboard, and never falls
 * back to `navigator.clipboard`. Async to keep the shape of the backend call
 * it replaced; the work itself is synchronous.
 */
export async function copyText(text: string): Promise<CopyResult> {
  const doc = hostDocument();
  // A textarea, not an input, so newlines survive. Fixed and off-screen so
  // nothing flashes or scrolls.
  const area = doc.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-9999px";
  area.style.left = "-9999px";
  area.style.opacity = "0";
  // select() focuses the textarea in Chromium; hand focus back afterwards so
  // controller focus stays where the player was.
  const focused = doc.activeElement as HTMLElement | null;
  doc.body.appendChild(area);
  try {
    notifyUserActivation();
    area.select();
    if (doc.execCommand("copy")) {
      return { ok: true, message: "" };
    }
    return { ok: false, message: "The webview refused the copy command." };
  } catch (e) {
    console.error("[wowdeck] copy to clipboard failed", e);
    const reason = e instanceof Error ? e.message || e.name : String(e);
    return { ok: false, message: `The copy command failed: ${reason}` };
  } finally {
    area.remove();
    if (focused && focused !== doc.body && focused !== doc.activeElement) {
      focused.focus?.({ preventScroll: true });
    }
  }
}
