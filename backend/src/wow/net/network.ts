/** Fetch-based network client for providers (replaces WowUp's NetworkInterface + DownloadService). */

import { ProviderError } from "../errors";

export interface RequestOptions {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  /** Applies to the whole request, body included (unless `streamBody`). */
  timeoutMs?: number;
  /**
   * Hand back the response with its body still streaming (downloads, which
   * may legitimately take longer than the timeout). Default false: the body
   * is read inside the timeout, so a connection that stalls mid-body cannot
   * hang forever. The engine serves one RPC at a time, so one such hang
   * blocked every later request (Details descriptions and changelogs stopped
   * loading until a plugin reload; owner report, 2026-10-16).
   */
  streamBody?: boolean;
  /**
   * Hostnames (exact match, or a dot-suffix match like "forgecdn.net"
   * covering "edge.forgecdn.net") that `headers` may
   * be sent to — including across a redirect. When set, `headers` is
   * sent on the first request as normal, but if the response redirects
   * to a host outside this list, `headers` is dropped for that hop and
   * every hop after it (even if a later redirect lands back on a
   * trusted host — once broken, this request never resends the
   * credential). Plain `fetch`'s `redirect: "follow"` only strips the
   * handful of headers the Fetch spec itself treats as sensitive
   * (`Authorization`, `Cookie`, ...) on a cross-origin redirect — a
   * provider's own custom header (e.g. CurseForge's `X-Api-Key`) is not
   * among those, so it would otherwise be forwarded to wherever a
   * redirect points, including a host this project has no reason to
   * trust with that credential. Omit this option (existing behavior,
   * unchanged) for requests that carry no credential worth protecting.
   */
  trustedHostsForHeaders?: string[];
}

/** Exact or dot-suffix hostname match (`forgecdn.net` matches `edge.forgecdn.net` too). */
function isHostTrusted(hostname: string, trustedHosts: string[]): boolean {
  const target = hostname.toLowerCase();
  return trustedHosts.some((host) => {
    const h = host.toLowerCase();
    return target === h || target.endsWith(`.${h}`);
  });
}

export class NetworkError extends Error {
  constructor(
    message: string,
    public status?: number,
    public url?: string,
    /** Response headers, lower-cased keys (GitHub rate-limit detection needs x-ratelimit-*). */
    public headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

function buildUrl(url: string, query?: Record<string, string>): string {
  if (!query || Object.keys(query).length === 0) {
    return url;
  }
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
}

/** Redact potential tokens/keys from URLs before logging (AGENTS.md rule 12). */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = u.search ? "?…" : "";
    if (u.pathname.split("/").some((p) => p.length > 24)) {
      return `${u.origin}${u.pathname.split("/").slice(0, -1).join("/")}/[redacted]`;
    }
    return u.toString();
  } catch {
    return "[invalid-url]";
  }
}

export class NetworkClient {
  async postJson<T>(url: string, options: RequestOptions & { body?: unknown } = {}): Promise<T> {
    const res = await this.requestWithRetry("POST", url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new NetworkError(`invalid JSON response from ${redactUrl(url)}`);
    }
  }

  async getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const res = await this.requestWithRetry("GET", url, options);
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new NetworkError(`invalid JSON response from ${redactUrl(url)}`);
    }
  }

  /**
   * HEAD a URL and report whether it's actually reachable, without ever
   * downloading the body — for a lightweight capability probe, not for
   * fetching real content. Three-way result mirrors the project's own
   * rule for ambiguous evidence (see classifyCurseForgeError): "failed"
   * only for a definitive, non-transient HTTP failure (a 4xx other than
   * 429); a network error, timeout, 429 or 5xx is "inconclusive" rather
   * than "failed", since those don't prove the URL itself is broken.
   */
  async headOk(url: string, options: RequestOptions = {}): Promise<"ok" | "failed" | "inconclusive"> {
    try {
      await this.requestWithRetry("HEAD", url, options);
      return "ok";
    } catch (err) {
      if (err instanceof NetworkError && err.status !== undefined && err.status !== 429 && err.status < 500) {
        return "failed";
      }
      return "inconclusive";
    }
  }

  async getText(url: string, options: RequestOptions = {}): Promise<string> {
    const res = await this.requestWithRetry("GET", url, options);
    return res.text();
  }

  /**
   * Stream a download to a file with progress callbacks.
   * Returns the byte count written.
   */
  async downloadToFile(
    url: string,
    destinationPath: string,
    options: RequestOptions & { onProgress?: (received: number, total: number | null) => void } = {},
  ): Promise<number> {
    const res = await this.requestWithRetry("GET", url, { ...options, streamBody: true });
    const total = res.headers.get("content-length") ? Number(res.headers.get("content-length")) : null;
    let received = 0;
    const chunks: Uint8Array[] = [];
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          options.onProgress?.(received, total);
        }
      }
    }
    await Bun.write(destinationPath, Buffer.concat(chunks.map((c) => Buffer.from(c))));
    return received;
  }

  /**
   * Fetch with bounded retries: transient network errors, 5xx and 429 are
   * retried twice with linear backoff (deck Wi-Fi can be flaky). 4xx other
   * than 429 fails immediately.
   */
  private async requestWithRetry(
    method: string,
    url: string,
    options: RequestOptions & { body?: string } = {},
  ): Promise<Response> {
    const target = buildUrl(url, options.query);
    let lastError: unknown;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const res = await this.fetchWithTimeout(target, options, method, options.body);
        const retryable = res.status >= 500 || res.status === 429;
        if (!retryable || attempt === 2) {
          if (!res.ok) {
            throw new NetworkError(
              `${method} ${redactUrl(url)} failed: HTTP ${res.status}`,
              res.status,
              url,
              Object.fromEntries(res.headers.entries()),
            );
          }
          return res;
        }
        lastError = new NetworkError(`${method} ${redactUrl(url)} transient HTTP ${res.status}`, res.status, url);
      } catch (err) {
        if (err instanceof NetworkError && err.status !== undefined && err.status < 500 && err.status !== 429) {
          throw err;
        }
        lastError = err;
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    throw lastError instanceof Error ? lastError : new NetworkError(`request to ${redactUrl(url)} failed`);
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestOptions & { body?: string },
    method = "GET",
    body?: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
    try {
      const res = options.trustedHostsForHeaders
        ? await this.fetchFollowingTrustedRedirects(url, options, method, body, controller.signal)
        : await fetch(url, {
            method,
            body,
            signal: controller.signal,
            headers: { "User-Agent": "wowdeck/0.1 (addon manager)", ...options.headers },
            redirect: "follow",
          });
      if (options.streamBody) {
        return res;
      }
      // Read the body while the timeout still runs (see `streamBody`).
      const noBody = method === "HEAD" || [101, 204, 205, 304].includes(res.status);
      const buffer = noBody ? null : await res.arrayBuffer();
      return new Response(buffer, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (err) {
      throw new NetworkError(`request to ${redactUrl(url)} failed: ${String(err)}`, undefined, url);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Follows redirects by hand (`redirect: "manual"` per hop) instead of
   * trusting `fetch`'s own `redirect: "follow"`, specifically so a
   * credential-bearing header never survives a redirect to a host
   * outside `options.trustedHostsForHeaders` — see that option's own
   * doc comment on why `fetch`'s built-in cross-origin header stripping
   * doesn't cover this (it only strips a fixed, spec-defined header
   * set, never a provider's own custom header).
   */
  private async fetchFollowingTrustedRedirects(
    initialUrl: string,
    options: RequestOptions & { body?: string },
    method: string,
    body: string | undefined,
    signal: AbortSignal,
  ): Promise<Response> {
    const trustedHosts = options.trustedHostsForHeaders!;
    let currentUrl = initialUrl;
    let currentHeaders: Record<string, string> = {
      "User-Agent": "wowdeck/0.1 (addon manager)",
      ...options.headers,
    };
    const MAX_REDIRECTS = 8;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(currentUrl, { method, body, signal, headers: currentHeaders, redirect: "manual" });
      const isRedirect = res.status >= 300 && res.status < 400;
      const location = isRedirect ? res.headers.get("location") : null;
      if (!isRedirect || !location) {
        return res;
      }
      const nextUrl = new URL(location, currentUrl).toString();
      if (!isHostTrusted(new URL(nextUrl).hostname, trustedHosts)) {
        // Leaving the trusted set — drop the credential for this hop and
        // every hop after it, even if a later redirect happens to land
        // back on a trusted host.
        currentHeaders = { "User-Agent": "wowdeck/0.1 (addon manager)" };
      }
      currentUrl = nextUrl;
    }
    throw new NetworkError(`too many redirects for ${redactUrl(initialUrl)}`, undefined, initialUrl);
  }
}

/** Minimal helper providers use to wrap network failures. */
export function wrapProviderError(provider: string, err: unknown): ProviderError {
  if (err instanceof ProviderError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError(provider, message, err instanceof NetworkError ? "network_error" : "provider_error");
}
