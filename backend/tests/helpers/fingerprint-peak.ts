/**
 * Child process for the fingerprint memory test: fingerprints the addon
 * folder in argv[2] and prints how far this process's resident high-water
 * mark grew while it did, in KiB, then the fingerprint.
 */

import { scanWowUpFolder } from "../../src/wow/addons/FingerprintScanner";
import { highWaterKiB } from "./high-water";

const before = highWaterKiB();
const result = await scanWowUpFolder(process.argv[2]!);
console.log(JSON.stringify({ grownKiB: highWaterKiB() - before, fileCount: result.fileCount, fingerprint: result.fingerprint }));
