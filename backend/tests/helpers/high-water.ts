/**
 * This process's resident high-water mark (VmHWM), in KiB. It is per process
 * and starts fresh at exec, unlike getrusage's maxRSS, which a child can
 * inherit from its parent; Linux only. Memory tests read it in a child
 * process so the test runner's own high-water mark can't hide the growth.
 */

import { readFileSync } from "node:fs";

export function highWaterKiB(): number {
  const match = /^VmHWM:\s+(\d+) kB$/m.exec(readFileSync("/proc/self/status", "utf8"));
  if (!match) {
    throw new Error("no VmHWM in /proc/self/status");
  }
  return Number(match[1]);
}
