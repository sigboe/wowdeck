/**
 * Engine entry point: maps the environment to the engine's configuration
 * and runs it (engine.ts holds the assembly), or lists the methods it
 * serves. All logging goes to stderr; stdout is the protocol stream.
 */

import { version } from "../package.json";
import { configFromEnv, runEngine } from "./engine";
import { methodNames } from "./api/handlers";

// `--methods` prints the served method names as JSON and exits (the
// integration tests and tools/deck-ui read it); nothing is started.
if (process.argv.includes("--methods")) {
  console.log(JSON.stringify(methodNames()));
  process.exit(0);
}

/** Bundled into the binary from backend/package.json at build time. */
const config = configFromEnv(process.env, version);
console.error(`[engine] wowdeck backend ${config.backendVersion} starting (pid ${process.pid})`);
console.error(`[engine] data dir: ${config.dataDir}`);
await runEngine(config);
