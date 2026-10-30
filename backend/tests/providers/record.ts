/**
 * Records the provider cassettes the contract suite replays: makes every
 * scenario's requests (scenarios.ts) against the real services and writes
 * what came back. Needs the network, so it is never part of `make test`.
 *
 *   make record-provider-fixtures [PROVIDERS="github wowinterface"]
 *
 * Credentials come from the environment and are only ever sent as request
 * headers, which a cassette does not keep:
 *   CURSEFORGE_API_KEY       the key itself, or
 *   CURSEFORGE_API_KEY_FILE  a file holding it (e.g. the git-ignored CURSEFORGE_API_KEY)
 *   GITHUB_TOKEN             optional; raises GitHub's rate limit
 * A cassette that still contains one of them, or a signed or keyed URL, is
 * not written.
 *
 * Lists in a response keep their first LIST_LIMIT entries, verbatim: enough
 * for every scenario, and the Hub's featured lists alone are most of a
 * megabyte.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Cassette, cassettePath, RecordingNetwork } from "./cassette";
import { type Credentials, exercise, scenarios } from "./scenarios";

const LIST_LIMIT = 10;
const KEYED_URL_RE = /[?&](key|api_?key|token|access_token|sig|signature|x-amz-signature|x-amz-credential|jwt)=/i;

function credentials(): Credentials {
  const keyFile = process.env.CURSEFORGE_API_KEY_FILE;
  const curseForgeKey =
    process.env.CURSEFORGE_API_KEY?.trim() || (keyFile ? readFileSync(keyFile, "utf-8").trim() : "") || undefined;
  return { curseForgeKey, githubToken: process.env.GITHUB_TOKEN?.trim() || undefined };
}

/** The response with its lists, top-level or one level down, cut to LIST_LIMIT. */
function shorten(response: unknown): unknown {
  if (Array.isArray(response)) {
    return response.slice(0, LIST_LIMIT);
  }
  if (response && typeof response === "object") {
    return Object.fromEntries(
      Object.entries(response).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, LIST_LIMIT) : v]),
    );
  }
  return response;
}

/** Why this cassette must not be written, or undefined when it is clean. */
function leak(cassette: Cassette, secrets: Array<string | undefined>): string | undefined {
  const text = JSON.stringify(cassette);
  if (secrets.some((secret) => secret && text.includes(secret))) {
    return "contains a credential";
  }
  const keyed = KEYED_URL_RE.exec(text);
  return keyed ? `contains a keyed or signed URL (${keyed[0]})` : undefined;
}

const wanted = process.argv.slice(2);
const creds = credentials();
const recordedAt = new Date().toISOString().slice(0, 10);
let failed = false;

for (const scenario of scenarios) {
  const fixture = scenario.fixture;
  if (!fixture || (wanted.length && !wanted.includes(fixture))) {
    continue;
  }
  if (fixture === "curseforge" && !creds.curseForgeKey) {
    console.error(`[record] ${fixture}: skipped, set CURSEFORGE_API_KEY or CURSEFORGE_API_KEY_FILE`);
    continue;
  }
  const network = new RecordingNetwork();
  const provider = scenario.make(network, creds);
  for (const capability of scenario.capabilities) {
    try {
      await exercise[capability](provider, scenario);
    } catch (err) {
      console.error(`[record] ${fixture} ${capability}: ${err instanceof Error ? err.message : String(err)}`);
      failed = true;
    }
  }
  const cassette = network.cassette(recordedAt);
  for (const interaction of cassette.interactions) {
    interaction.response = shorten(interaction.response);
  }
  const problem = leak(cassette, [creds.curseForgeKey, creds.githubToken]);
  if (problem) {
    console.error(`[record] ${fixture}: not written, the recording ${problem}`);
    failed = true;
    continue;
  }
  const path = cassettePath(fixture);
  mkdirSync(dirname(path), { recursive: true });
  // One response per line: half the size of indented JSON, and a re-record
  // still diffs response by response.
  const lines = cassette.interactions.map((i) => `    ${JSON.stringify(i)}`).join(",\n");
  await Bun.write(path, `{\n  "recordedAt": "${cassette.recordedAt}",\n  "interactions": [\n${lines}\n  ]\n}\n`);
  console.error(`[record] ${fixture}: ${cassette.interactions.length} responses`);
}

process.exit(failed ? 1 : 0);
