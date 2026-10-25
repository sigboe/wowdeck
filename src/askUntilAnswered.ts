/**
 * Asks again when a call gets no answer at all. A call sent while Decky
 * reloads the plugin (an update, or a reload from the developer menu) reaches
 * the Python side that is being replaced and is never answered (DEVICE
 * 2026-10-21: a QAM opened in the ~5 s before the new frontend loads stayed
 * empty until reopened); asked again, it reaches the new one. Only for quick
 * calls: an answer slower than `timeoutMs` counts as none. Rejects with the
 * call's own error, or once `attempts` calls went unanswered.
 */
export async function askUntilAnswered<T>(
  call: () => Promise<T>,
  { timeoutMs, attempts }: { timeoutMs: number; attempts: number },
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unanswered = new Promise<"unanswered">((resolve) => {
      timer = setTimeout(() => resolve("unanswered"), timeoutMs);
    });
    try {
      const answer = await Promise.race([call(), unanswered]);
      if (answer !== "unanswered") {
        return answer;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`no answer after ${attempts} tries`);
}
