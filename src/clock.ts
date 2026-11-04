/**
 * Timers a module schedules through, so tests can drive polling without the
 * wall clock (AGENTS.md: deterministic tests). Production uses `systemClock`;
 * tests use `createManualClock` (testSupport/manualClock.ts).
 */
export interface Clock {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const systemClock: Clock = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};
