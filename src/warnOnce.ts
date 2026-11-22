/**
 * A warning for a Steam UI patch that gave up: logged once per session, so
 * a page that re-renders doesn't repeat it. `subject` says what the player
 * doesn't see; each call names why.
 */
export function createWarnOnce(subject: string): (what: string, error?: unknown) => void {
  let warned = false;
  return (what, error) => {
    if (warned) return;
    warned = true;
    console.warn(`wowdeck: ${subject} (${what})`, error ?? "");
  };
}
