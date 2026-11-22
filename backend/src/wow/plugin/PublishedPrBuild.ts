import type { PrBuild } from "../../api/contracts";

/**
 * A listed PR build with what installing it needs: the zip and its
 * checksum. One entry of the published list on both sides of it: the PR
 * build tool writes this shape and the engine parses it, from one
 * definition.
 */
export interface PublishedPrBuild extends PrBuild {
  /** The zip's sha256, 64 lowercase hex. */
  sha256: string;
  /** Where the zip is served. */
  zipUrl: string;
}
