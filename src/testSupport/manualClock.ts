import type { Clock } from "../clock";

/** A `Clock` that only moves when a test calls `advance`. */
export interface ManualClock extends Clock {
  /** Move time forward, firing every interval that comes due, in order. */
  advance(ms: number): void;
  /** Intervals currently scheduled. */
  activeTimers(): number;
}

export function createManualClock(): ManualClock {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { every: number; due: number; callback: () => void }>();
  return {
    setInterval(callback, ms) {
      const id = nextId++;
      timers.set(id, { every: ms, due: now + ms, callback });
      return id;
    },
    clearInterval(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next: [number, { every: number; due: number; callback: () => void }] | null = null;
        for (const entry of timers) {
          if (entry[1].due <= end && (!next || entry[1].due < next[1].due)) {
            next = entry;
          }
        }
        if (!next) {
          break;
        }
        now = next[1].due;
        next[1].due += next[1].every;
        next[1].callback();
      }
      now = end;
    },
    activeTimers: () => timers.size,
  };
}
