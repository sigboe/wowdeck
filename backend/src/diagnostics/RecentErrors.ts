/**
 * Bounded recent-operation-error buffer backing `system.diagnostics`'s
 * `recentErrors` field. Kept as its own small, independently testable
 * unit rather than inline state in main.ts's composition root.
 */

export interface RecentError {
  time: string;
  method: string;
  message: string;
}

const MAX_MESSAGE_LENGTH = 200;

export class RecentErrorsBuffer {
  #items: RecentError[] = [];

  constructor(private readonly max = 10) {}

  /** Newest first. `message` is clamped — callers must already have stripped secrets/URLs. */
  record(method: string, message: string): void {
    this.#items.unshift({
      time: new Date().toISOString(),
      method,
      message: message.slice(0, MAX_MESSAGE_LENGTH),
    });
    if (this.#items.length > this.max) {
      this.#items.length = this.max;
    }
  }

  list(): RecentError[] {
    return [...this.#items];
  }
}
