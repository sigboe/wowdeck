/**
 * Key-source selection and error classification, fully isolated from
 * CurseForgeProvider and the network layer — CurseForgeAuthService and
 * classifyCurseForgeError are pure/testable on their own.
 */

import { describe, expect, test } from "bun:test";
import {
  CurseForgeAuthService,
  classifyCurseForgeError,
} from "../src/wow/providers/curseforge/CurseForgeKeyAuth";
import { NetworkError } from "../src/wow/net/network";

function err(status: number | undefined): NetworkError {
  return new NetworkError("boom", status, "https://api.curseforge.com/v1/x");
}

describe("classifyCurseForgeError", () => {
  test("401 is always a confirmed invalid key, regardless of endpoint", () => {
    expect(classifyCurseForgeError(err(401), false)).toBe("invalid_key");
    expect(classifyCurseForgeError(err(401), true)).toBe("invalid_key");
  });

  // CurseForge's Featured endpoint has been observed to 403 for an
  // otherwise-good key. Only the dedicated health-check endpoint's
  // 403 is strong enough evidence.
  test("403 on a normal endpoint is an endpoint restriction, not proof of an invalid key", () => {
    expect(classifyCurseForgeError(err(403), false)).toBe("endpoint_restricted");
  });

  test("403 on the dedicated key-check endpoint is a confirmed invalid key", () => {
    expect(classifyCurseForgeError(err(403), true)).toBe("invalid_key");
  });

  test("429 is rate limiting", () => {
    expect(classifyCurseForgeError(err(429), false)).toBe("rate_limited");
  });

  test("5xx is a server error", () => {
    expect(classifyCurseForgeError(err(500), false)).toBe("server_error");
    expect(classifyCurseForgeError(err(503), false)).toBe("server_error");
  });

  test("no HTTP status at all is a network/DNS/timeout failure", () => {
    expect(classifyCurseForgeError(err(undefined), false)).toBe("network_error");
  });

  test("a non-NetworkError (e.g. a download/CDN failure) is not auth evidence", () => {
    expect(classifyCurseForgeError(new Error("malformed zip"), false)).toBe("other");
  });

  test("an unrelated 4xx is neither an invalid key nor a restriction", () => {
    expect(classifyCurseForgeError(err(404), false)).toBe("other");
  });
});

describe("CurseForgeAuthService key-source selection", () => {
  test("a working bundled key is selected over any saved user key", () => {
    const svc = new CurseForgeAuthService("bundled-key", () => "user-key");
    svc.setBundledCheckResult(true);
    svc.setUserCheckResult("user-key", true);
    expect(svc.activeSource()).toBe("bundled");
    expect(svc.activeKey()).toBe("bundled-key");
  });

  test("no bundled key selects a valid user key", () => {
    const svc = new CurseForgeAuthService(undefined, () => "user-key");
    svc.setUserCheckResult("user-key", true);
    expect(svc.activeSource()).toBe("user");
    expect(svc.activeKey()).toBe("user-key");
  });

  test("a confirmed-invalid bundled key falls back to a valid user key", () => {
    const svc = new CurseForgeAuthService("bundled-key", () => "user-key");
    svc.setBundledCheckResult(false);
    svc.setUserCheckResult("user-key", true);
    expect(svc.activeSource()).toBe("user");
    expect(svc.activeKey()).toBe("user-key");
  });

  test("invalid bundled key with no user key reports no active key at all", () => {
    const svc = new CurseForgeAuthService("bundled-key", () => undefined);
    svc.setBundledCheckResult(false);
    expect(svc.activeSource()).toBe("none");
    expect(svc.activeKey()).toBeUndefined();
  });

  test("no bundled key and no user key reports no active key", () => {
    const svc = new CurseForgeAuthService(undefined, () => undefined);
    expect(svc.activeSource()).toBe("none");
  });

  test("a previously inactive (unvalidated) user key becomes the active source once the bundled key fails", () => {
    const svc = new CurseForgeAuthService("bundled-key", () => "user-key");
    expect(svc.activeSource()).toBe("bundled"); // bundled wins first, even unvalidated
    svc.setBundledCheckResult(false);
    expect(svc.snapshot().userStatus).toBe("unvalidated"); // never explicitly checked this session...
    expect(svc.activeSource()).toBe("user"); // ...but still usable (see resolveActive's own comment)
    svc.setUserCheckResult("user-key", true); // and an explicit check only strengthens that to "valid"
    expect(svc.activeSource()).toBe("user");
    expect(svc.snapshot().userStatus).toBe("valid");
  });

  test("a working bundled key takes precedence again after an explicit revalidation", () => {
    const svc = new CurseForgeAuthService("bundled-key", () => "user-key");
    svc.setBundledCheckResult(false);
    svc.setUserCheckResult("user-key", true);
    expect(svc.activeSource()).toBe("user");

    svc.setBundledCheckResult(true); // explicit revalidation succeeds
    expect(svc.activeSource()).toBe("bundled");
    // the saved user key must survive, not be deleted, by this switch
    expect(svc.snapshot().userConfigured).toBe(true);
  });

  test("snapshot reports the real active source and never the merely-configured-but-inactive one", () => {
    const svc = new CurseForgeAuthService("bundled-key", () => "user-key");
    svc.setBundledCheckResult(true);
    svc.setUserCheckResult("user-key", true);
    const snap = svc.snapshot();
    expect(snap.activeSource).toBe("bundled");
    expect(snap.userConfigured).toBe(true);
    expect(snap.userStatus).toBe("valid"); // configured+valid, but not active
  });

  test("a brand new user key (different value) starts unvalidated, never inheriting the old key's invalid verdict", () => {
    let userKey = "old-key";
    const svc = new CurseForgeAuthService(undefined, () => userKey);
    svc.setUserCheckResult("old-key", false); // old key was confirmed bad
    expect(svc.activeSource()).toBe("none");

    userKey = "new-key"; // replaced via Options with a different value
    expect(svc.snapshot().userStatus).toBe("unvalidated"); // not "invalid" — that verdict was about a different secret
    expect(svc.activeSource()).toBe("user"); // usable again (unvalidated, not invalid)
  });

  test("setUserCheckResult records the verdict against the exact key value given, not whatever getUserKey() returns", () => {
    // backend/src/main.ts's settings.set handler calls this
    // immediately after persisting a new curseApiKey, passing that
    // exact value explicitly — this must work correctly as long as
    // getUserKey() already reflects the same value by the time
    // anything reads status back (true in that handler: persist,
    // *then* record, no interleaving in between).
    const userKey = "candidate-key";
    const svc = new CurseForgeAuthService(undefined, () => userKey);
    svc.setUserCheckResult("candidate-key", true);
    expect(svc.snapshot().userStatus).toBe("valid");
    expect(svc.activeSource()).toBe("user");
  });

  test("a verdict recorded against a stale key value is discarded once getUserKey() diverges from it", () => {
    // Guards against the opposite mistake: never trust an old
    // recorded verdict for a key value that isn't the one actually
    // configured right now.
    let userKey: string | undefined = "old-key";
    const svc = new CurseForgeAuthService(undefined, () => userKey);
    svc.setUserCheckResult("old-key", true);
    expect(svc.snapshot().userStatus).toBe("valid");

    userKey = "different-key"; // getUserKey() now disagrees with the recorded verdict's key
    expect(svc.snapshot().userStatus).toBe("unvalidated");
  });

  test("clearing the user key is reported as not configured", () => {
    let userKey: string | undefined = "a-key";
    const svc = new CurseForgeAuthService(undefined, () => userKey);
    svc.setUserCheckResult("a-key", true);
    userKey = undefined;
    const snap = svc.snapshot();
    expect(snap.userConfigured).toBe(false);
    expect(snap.activeSource).toBe("none");
  });
});

describe("CurseForgeAuthService runtime fallback via recordNormalOutcome", () => {
  test("a definitive invalid-key outcome on the bundled key switches to a valid user key", () => {
    const svc = new CurseForgeAuthService("bundled-key", () => "user-key");
    svc.setBundledCheckResult(true);
    svc.setUserCheckResult("user-key", true);
    expect(svc.activeSource()).toBe("bundled");

    svc.recordNormalOutcome(err(401)); // a normal request using the bundled key got a definitive rejection
    expect(svc.snapshot().bundledStatus).toBe("invalid");
    expect(svc.activeSource()).toBe("user");
  });

  test("an endpoint restriction (403 on a normal endpoint) never invalidates the bundled key", () => {
    const svc = new CurseForgeAuthService("bundled-key", () => undefined);
    svc.setBundledCheckResult(true);
    svc.recordNormalOutcome(err(403));
    expect(svc.snapshot().bundledStatus).toBe("valid"); // unchanged — already proven valid
    expect(svc.activeSource()).toBe("bundled");
  });

  test("rate limiting never downgrades an already-valid key", () => {
    const svc = new CurseForgeAuthService("bundled-key", () => undefined);
    svc.setBundledCheckResult(true);
    svc.recordNormalOutcome(err(429));
    expect(svc.snapshot().bundledStatus).toBe("valid");
  });

  test("a transient failure on a never-yet-validated key reports 'unknown', not 'invalid'", () => {
    const svc = new CurseForgeAuthService("bundled-key", () => undefined);
    svc.recordNormalOutcome(err(undefined)); // network error, before any explicit check
    expect(svc.snapshot().bundledStatus).toBe("unknown");
    expect(svc.activeSource()).toBe("bundled"); // "unknown" is not "invalid" — still preferred
  });

  test("a successful normal request upgrades an unknown bundled key back to valid", () => {
    const svc = new CurseForgeAuthService("bundled-key", () => undefined);
    svc.recordNormalOutcome(err(undefined));
    expect(svc.snapshot().bundledStatus).toBe("unknown");
    svc.recordNormalOutcome(null);
    expect(svc.snapshot().bundledStatus).toBe("valid");
  });

  test("outcomes are attributed to the user key once it's the active source", () => {
    const svc = new CurseForgeAuthService("bundled-key", () => "user-key");
    svc.setBundledCheckResult(false);
    svc.setUserCheckResult("user-key", true);
    expect(svc.activeSource()).toBe("user");

    svc.recordNormalOutcome(err(401));
    const snap = svc.snapshot();
    expect(snap.userStatus).toBe("invalid");
    expect(snap.bundledStatus).toBe("invalid"); // unchanged by this call
    expect(svc.activeSource()).toBe("none"); // both now invalid
  });

  test("recordNormalOutcome is a no-op when there is no active key at all", () => {
    const svc = new CurseForgeAuthService(undefined, () => undefined);
    expect(() => svc.recordNormalOutcome(err(401))).not.toThrow();
    expect(svc.activeSource()).toBe("none");
  });
});

describe("CurseForgeAuthService.recheck (RF-14)", () => {
  const verdict = (ok: boolean, confirmed?: boolean) => async () => ({ ok, httpStatus: ok ? 200 : 403, message: "", ...(confirmed === undefined ? {} : { confirmed }) });

  test("a confirmed bundled verdict is recorded", async () => {
    const svc = new CurseForgeAuthService("bundled-key", () => undefined);
    await svc.recheck(verdict(false));
    expect(svc.snapshot().bundledStatus).toBe("invalid");
    await svc.recheck(verdict(true));
    expect(svc.snapshot().bundledStatus).toBe("valid");
  });

  test("an inconclusive check records nothing", async () => {
    const svc = new CurseForgeAuthService("bundled-key", () => undefined);
    await svc.recheck(verdict(false, false));
    expect(svc.snapshot().bundledStatus).toBe("unvalidated");
  });

  test("a user key's verdict goes to the user key; no bundled key, no check", async () => {
    const svc = new CurseForgeAuthService(undefined, () => "user-key");
    let calls = 0;
    await svc.recheck(async () => (calls++, { ok: true, httpStatus: 200, message: "" }));
    expect(calls).toBe(0);
    await svc.recheck(verdict(false), "user-key");
    expect(svc.snapshot().userStatus).toBe("invalid");
  });
});
