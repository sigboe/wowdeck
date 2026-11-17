/** Offline maintainer tool. Never approves output collected from a native preview.
 * Input two is independently reviewed expected mappings transcribed from the
 * source VDF for one controller conversion, in NativeLayoutModel JSON shape. */
import { createHash } from "node:crypto";
import { mappingContent, type NativeLayoutModel } from "../../src/controllerLayoutPreview";

const [vdfPath, expectedPath, reviewedHash] = process.argv.slice(2);
if (!vdfPath || !expectedPath || !/^[a-f0-9]{64}$/.test(reviewedHash ?? ""))
  throw Error("Usage: bun tools/controller-layouts/publication.ts approved.vdf independently-reviewed.json reviewed-vdf-sha256");
const bytes = await Bun.file(vdfPath).bytes();
if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw Error("Invalid source size");
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== reviewedHash) throw Error("Source differs from reviewed VDF");
const expectedFile = Bun.file(expectedPath);
if (expectedFile.size > 4 * 1024 * 1024) throw Error("Expected mappings exceed bound");
const model = await expectedFile.json() as NativeLayoutModel;
if (!Number.isSafeInteger(model.controller_type) || !Array.isArray(model.sets) ||
    !Array.isArray(model.modes) || !model.sets.length || !model.modes.length)
  throw Error("Expected complete reviewed mappings for one native controller type");
console.log(JSON.stringify({ sha256, previewMappings: {
  [String(model.controller_type)]: createHash("sha256").update(mappingContent(model)).digest("hex"),
} }, null, 2));
