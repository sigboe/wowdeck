/**
 * CurseForge key-source selection: a single, testable place that
 * decides which key (bundled or user-provided) is actually in
 * effect, and classifies real request failures into evidence the rest
 * of the system can safely act on.
 *
 * Deliberately NOT woven deep into CurseForgeProvider's own request
 * methods via a breaking constructor change — see that file's own
 * comment on `reportOutcome`. This keeps the ~25 existing
 * `new CurseForgeProvider(net, () => key)` test call sites valid
 * unchanged; only backend/src/main.ts (the real composition root)
 * wires the real service in.
 */

import { NetworkError } from "../../net/network";
import type { ApiKeyTestResult } from "../addon-provider";

export type CurseForgeKeyStatus = "unvalidated" | "valid" | "invalid" | "unknown";
export type CurseForgeKeySource = "bundled" | "user" | "none";

/**
 * Evidence extracted from one failed request. `invalid_key` is the
 * only category strong enough to ever mark a key invalid — everything
 * else is either genuinely unrelated to the credential (rate limiting,
 * server/network errors) or endpoint-specific and not proof the
 * credential itself is bad (CurseForge's Featured endpoint has been
 * observed to return 403 for an otherwise-good key).
 */
export type CurseForgeAuthEvidence =
  | "invalid_key"
  | "endpoint_restricted"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "other";

/**
 * Classify a thrown error from a CurseForge request. `isKeyCheckEndpoint`
 * must only be true for the dedicated health-check request
 * (`testApiKey`'s own `GET /v1/games` ping) — CurseForge's edge has
 * been observed to return 403 for a key it won't accept at all, which
 * is why 403 is
 * only treated as proof of an invalid key on that one endpoint. A 403
 * from any other endpoint (search, mods, categories, ...) is reported
 * as `endpoint_restricted` instead — ambiguous evidence that must not
 * downgrade a key's status.
 */
export function classifyCurseForgeError(err: unknown, isKeyCheckEndpoint: boolean): CurseForgeAuthEvidence {
  if (!(err instanceof NetworkError)) {
    return "other";
  }
  const status = err.status;
  if (status === undefined) {
    return "network_error";
  }
  if (status === 401) {
    return "invalid_key";
  }
  if (status === 403) {
    return isKeyCheckEndpoint ? "invalid_key" : "endpoint_restricted";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 500) {
    return "server_error";
  }
  return "other";
}

/**
 * Fold one outcome into a status. A success always proves "valid". An
 * `invalid_key` always proves "invalid". Everything else is ambiguous:
 * never downgrade an already-proven-valid key on a transient blip or
 * an unrelated endpoint restriction — a transient network failure or
 * rate-limit response must never cause the user-key entry section to
 * appear as though a key is invalid — but also never claim a fresh
 * key is "valid" just because nothing has failed yet.
 */
function nextStatus(evidence: CurseForgeAuthEvidence | "ok", previous: CurseForgeKeyStatus): CurseForgeKeyStatus {
  if (evidence === "ok") {
    return "valid";
  }
  if (evidence === "invalid_key") {
    return "invalid";
  }
  return previous === "valid" ? "valid" : "unknown";
}

export interface CurseForgeAuthSnapshot {
  activeSource: CurseForgeKeySource;
  bundledPresent: boolean;
  bundledStatus: CurseForgeKeyStatus;
  userConfigured: boolean;
  userStatus: CurseForgeKeyStatus;
}

interface ResolvedKey {
  key: string | undefined;
  source: CurseForgeKeySource;
}

/**
 * Owns the bundled key's identity/status and tracks the user key's
 * status against whatever `getUserKey()` currently returns (so a
 * freshly saved or cleared user key is never judged by a stale
 * verdict about a *different* secret). Status is intentionally
 * in-memory/session-scoped, not persisted — an invalid bundled key is
 * marked invalid only for the current runtime session or until safely
 * revalidated, matching an engine restart naturally re-checking from
 * scratch.
 */
export class CurseForgeAuthService {
  #bundledKey: string | undefined;
  #bundledStatus: CurseForgeKeyStatus = "unvalidated";
  #userStatus: CurseForgeKeyStatus = "unvalidated";
  #lastUserKeySeen: string | undefined;

  constructor(
    bundledKey: string | undefined,
    private getUserKey: () => string | undefined,
  ) {
    this.#bundledKey = bundledKey?.trim() || undefined;
  }

  private syncUserKeyIdentity(): void {
    const current = this.getUserKey();
    if (current !== this.#lastUserKeySeen) {
      this.#lastUserKeySeen = current;
      this.#userStatus = "unvalidated";
    }
  }

  /**
   * Priority: a working bundled key always wins; otherwise a
   * usable user key; otherwise nothing. "Usable" means status is
   * anything *other than* confirmed-invalid — `unvalidated` counts,
   * deliberately: a saved user key already passed validation at the
   * moment it was saved (Options' own save flow), it just hasn't
   * been re-confirmed yet *this runtime*, since status resets every
   * engine restart (not persisted). Treating a fresh `unvalidated` key
   * as unusable until some separate re-check ran would effectively
   * disable every configured key on every plugin reload, and would
   * also mean repeating a validation request that isn't needed. A
   * *confirmed-invalid* key (bundled or user) is never returned even
   * if it's the only one configured — callers must fall through to
   * "no key" rather than keep hammering a credential already known to
   * be rejected.
   */
  private resolveActive(): ResolvedKey {
    if (this.#bundledKey && this.#bundledStatus !== "invalid") {
      return { key: this.#bundledKey, source: "bundled" };
    }
    this.syncUserKeyIdentity();
    const userKey = this.getUserKey();
    if (userKey && this.#userStatus !== "invalid") {
      return { key: userKey, source: "user" };
    }
    return { key: undefined, source: "none" };
  }

  activeKey(): string | undefined {
    return this.resolveActive().key;
  }

  activeSource(): CurseForgeKeySource {
    return this.resolveActive().source;
  }

  snapshot(): CurseForgeAuthSnapshot {
    this.syncUserKeyIdentity();
    return {
      activeSource: this.activeSource(),
      bundledPresent: !!this.#bundledKey,
      bundledStatus: this.#bundledKey ? this.#bundledStatus : "unvalidated",
      userConfigured: !!this.getUserKey(),
      userStatus: this.getUserKey() ? this.#userStatus : "unvalidated",
    };
  }

  /**
   * Test a key with CurseForge and record the verdict: the bundled key, or
   * the user's key right after it was saved. An inconclusive result
   * (network, rate limit, server trouble) is not recorded, so a key is
   * never rejected because one check happened to fail transiently.
   */
  async recheck(test: (key: string) => Promise<ApiKeyTestResult>, userKey?: string): Promise<void> {
    const key = userKey ?? this.#bundledKey;
    if (!key) {
      return;
    }
    const result = await test(key);
    if (result.confirmed === false) {
      return;
    }
    if (userKey !== undefined) {
      this.setUserCheckResult(userKey, result.ok);
    } else {
      this.setBundledCheckResult(result.ok);
    }
  }

  /** Dedicated health-check result for the bundled key (startup, or an explicit on-demand recheck). */
  setBundledCheckResult(ok: boolean): void {
    if (!this.#bundledKey) {
      return;
    }
    this.#bundledStatus = ok ? "valid" : "invalid";
  }

  /**
   * Dedicated health-check result for a user key *candidate*. Takes
   * the key value explicitly rather than reading `getUserKey()` —
   * Options' "Save key" flow validates a candidate through
   * `providers.testApiKey` *before* persisting it (so the user gets
   * instant feedback without waiting on a settings round-trip), which
   * means the value isn't yet reflected by `getUserKey()` at the
   * moment the result is known. Recording the verdict against the
   * explicit key now means that once the candidate *is* saved moments
   * later, `syncUserKeyIdentity()` sees the same value it already has
   * a verdict for and doesn't reset it back to "unvalidated" — so the
   * key becomes active immediately on save, with no second
   * (wasteful) validation request against the newly-persisted value.
   */
  setUserCheckResult(key: string, ok: boolean): void {
    this.#lastUserKeySeen = key;
    this.#userStatus = ok ? "valid" : "invalid";
  }

  /**
   * Fold the outcome of one real (non-health-check) request
   * into whichever source is currently active. Call this after every
   * authenticated CurseForge request, success or failure — success
   * matters too, since it's exactly what lets a key recover from
   * "unknown" back to "valid" without a separate dedicated recheck.
   */
  recordNormalOutcome(err: unknown | null): void {
    const { source } = this.resolveActive();
    if (source === "none") {
      return;
    }
    const evidence = err ? classifyCurseForgeError(err, false) : "ok";
    if (source === "bundled") {
      this.#bundledStatus = nextStatus(evidence, this.#bundledStatus);
    } else {
      this.syncUserKeyIdentity();
      this.#userStatus = nextStatus(evidence, this.#userStatus);
    }
  }
}
