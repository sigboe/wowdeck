/**
 * Child process for the folder evidence memory test: digests the folder in
 * argv[2] and prints how far this process's resident high-water mark grew
 * while it did, in KiB, then the evidence.
 */

import { folderEvidence } from "../../src/wow/addons/FolderEvidence";
import { realStageFs } from "../../src/wow/fs/StageFs";
import { highWaterKiB } from "./high-water";

const before = highWaterKiB();
const evidence = await folderEvidence(realStageFs, process.argv[2]!);
console.log(JSON.stringify({ grownKiB: highWaterKiB() - before, evidence }));
