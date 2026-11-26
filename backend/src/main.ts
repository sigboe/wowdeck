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

/**
 * How long requests still in flight may finish once the host is gone. An
 * install or state write cut off here is no worse than the SIGKILL main.py
 * sends a stopping engine that does not exit: both are recoverable.
 */
const HOST_GONE_GRACE_MS = 2_000;

/**
 * stdin, ending when the host is gone. main.py is its only writer, so EOF
 * means the plugin process died or was killed without stopping the engine.
 * Timers, sockets (TradeSkillMaster) and requests still in flight would
 * otherwise keep an orphan running beside the next engine, on the same
 * data folder.
 */
async function* untilHostGone(): AsyncGenerator<Uint8Array> {
  yield* Bun.stdin.stream();
  console.error("[engine] stdin closed: the host is gone; exiting");
  setTimeout(() => process.exit(0), HOST_GONE_GRACE_MS);
}

await runEngine(config, untilHostGone());
process.exit(0);
