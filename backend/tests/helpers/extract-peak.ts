/**
 * Child process for the zip memory test: extracts the archive in argv[2]
 * into argv[3] and prints how far this process's resident high-water mark
 * grew while it did, in KiB, then the extraction's file count and size.
 */

import { extractArchive } from "../../src/wow/archives/ArchiveExtractor";
import { highWaterKiB } from "./high-water";

const before = highWaterKiB();
const result = await extractArchive(process.argv[2]!, process.argv[3]!);
console.log(JSON.stringify({ grownKiB: highWaterKiB() - before, fileCount: result.fileCount, totalBytes: result.totalBytes }));
