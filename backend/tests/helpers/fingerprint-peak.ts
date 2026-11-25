/**
 * Child process for the fingerprint memory test: fingerprints the addon
 * folder in argv[2] and prints how far this process's resident high-water
 * mark grew while it did, in KiB, then the fingerprint. Runs in its own
 * process so the test runner's own high-water mark can't hide the growth
 * (VmHWM is per process and starts fresh at exec; Linux only).
 */

import { readFileSync } from "node:fs";
import { scanWowUpFolder } from "../../src/wow/addons/FingerprintScanner";

function highWaterKiB(): number {
  const match = /^VmHWM:\s+(\d+) kB$/m.exec(readFileSync("/proc/self/status", "utf8"));
  if (!match) {
    throw new Error("no VmHWM in /proc/self/status");
  }
  return Number(match[1]);
}

const before = highWaterKiB();
const result = await scanWowUpFolder(process.argv[2]!);
console.log(JSON.stringify({ grownKiB: highWaterKiB() - before, fileCount: result.fileCount, fingerprint: result.fingerprint }));
