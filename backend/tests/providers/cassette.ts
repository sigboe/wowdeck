/**
 * Recorded provider responses ("cassettes") and the network clients that
 * record and replay them (AGENTS.md policy 7: providers are tested against
 * recorded responses, never the network).
 *
 * A cassette holds one provider's responses keyed by method, URL and body.
 * Request headers are never stored, so API keys and tokens (sent as headers)
 * cannot end up in one; record.ts also refuses to write a cassette that
 * contains a secret or a signed URL.
 */

import { NetworkClient, NetworkError, type RequestOptions } from "../../src/wow/net/network";

export interface Interaction {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
  status: number;
  /** Parsed JSON (getJson/postJson) or raw text (getText); absent for an error status. */
  response?: unknown;
}

export interface Cassette {
  recordedAt: string;
  interactions: Interaction[];
}

/** The URL a request reaches, query parameters sorted so key order never matters. */
export function requestUrl(url: string, query?: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query ?? {})) {
    u.searchParams.set(k, v);
  }
  u.searchParams.sort();
  return u.toString();
}

function keyOf(method: string, url: string, body: unknown): string {
  return `${method} ${url}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`;
}

/** The error NetworkClient throws for a recorded error status. */
function failure({ method, url, status }: Interaction): NetworkError {
  return new NetworkError(`${method} ${url} failed: HTTP ${status}`, status, url, {});
}

const FIXTURES = `${import.meta.dir}/../fixtures/providers`;

export function cassettePath(fixture: string): string {
  return `${FIXTURES}/${fixture}/cassette.json`;
}

export async function loadCassette(fixture: string): Promise<Cassette> {
  return (await Bun.file(cassettePath(fixture)).json()) as Cassette;
}

/** One recorded response body, for tests that build on real data. */
export function recorded<T>(cassette: Cassette, method: Interaction["method"], urlPrefix: string): T {
  const hit = cassette.interactions.find((i) => i.method === method && i.url.startsWith(urlPrefix) && i.status < 400);
  if (!hit) {
    throw new Error(`cassette has no ${method} ${urlPrefix}`);
  }
  return structuredClone(hit.response) as T;
}

/**
 * Answers from a cassette. A request it has no recording for throws and is
 * listed in `misses`, since some providers swallow errors (a failed
 * release.json just means "use the file names"); tests assert it stays empty.
 */
export class ReplayNetwork extends NetworkClient {
  readonly misses: string[] = [];
  readonly #byKey: Map<string, Interaction>;

  constructor(cassette: Cassette) {
    super();
    this.#byKey = new Map(cassette.interactions.map((i) => [keyOf(i.method, i.url, i.body), i]));
  }

  override async getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
    return this.#replay("GET", requestUrl(url, options.query), undefined) as T;
  }

  override async postJson<T>(url: string, options: RequestOptions & { body?: unknown } = {}): Promise<T> {
    return this.#replay("POST", requestUrl(url, options.query), options.body) as T;
  }

  override async getText(url: string, options: RequestOptions = {}): Promise<string> {
    return this.#replay("GET", requestUrl(url, options.query), undefined) as string;
  }

  override async headOk(url: string): Promise<"ok" | "failed" | "inconclusive"> {
    throw this.#miss(`HEAD ${url}`);
  }

  override async downloadToFile(url: string): Promise<number> {
    throw this.#miss(`DOWNLOAD ${url}`);
  }

  #replay(method: Interaction["method"], url: string, body: unknown): unknown {
    const hit = this.#byKey.get(keyOf(method, url, body));
    if (!hit) {
      throw this.#miss(keyOf(method, url, body));
    }
    if (hit.status >= 400) {
      throw failure(hit);
    }
    return structuredClone(hit.response);
  }

  #miss(key: string): Error {
    this.misses.push(key);
    return new Error(`no recorded response for ${key} (re-record: make record-provider-fixtures)`);
  }
}

/**
 * Real requests, each kept for the cassette. A repeated request is answered
 * from what was already recorded, so one recording run asks each URL once.
 */
export class RecordingNetwork extends NetworkClient {
  readonly #byKey = new Map<string, Interaction>();

  override async getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const target = requestUrl(url, options.query);
    return this.#record("GET", target, undefined, () => super.getJson<T>(url, options)) as Promise<T>;
  }

  override async postJson<T>(url: string, options: RequestOptions & { body?: unknown } = {}): Promise<T> {
    const target = requestUrl(url, options.query);
    return this.#record("POST", target, options.body, () => super.postJson<T>(url, options)) as Promise<T>;
  }

  override async getText(url: string, options: RequestOptions = {}): Promise<string> {
    const target = requestUrl(url, options.query);
    return this.#record("GET", target, undefined, () => super.getText(url, options)) as Promise<string>;
  }

  cassette(recordedAt: string): Cassette {
    const interactions = [...this.#byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, i]) => i);
    return { recordedAt, interactions };
  }

  async #record(method: Interaction["method"], url: string, body: unknown, send: () => Promise<unknown>) {
    const key = keyOf(method, url, body);
    const kept = this.#byKey.get(key);
    if (kept) {
      if (kept.status >= 400) {
        throw failure(kept);
      }
      return structuredClone(kept.response);
    }
    const request = { method, url, ...(body === undefined ? {} : { body }) };
    try {
      const response = await send();
      this.#byKey.set(key, { ...request, status: 200, response });
      return structuredClone(response);
    } catch (err) {
      if (err instanceof NetworkError && err.status !== undefined) {
        this.#byKey.set(key, { ...request, status: err.status });
      }
      throw err;
    }
  }
}
