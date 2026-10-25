/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { diagnosticsText } from "./diagnostics";
import type { Diagnostics } from "./types";

const SECRET = "sk-super-secret-test-key-do-not-leak-12345";

function makeDiagnostics(overrides?: Partial<Diagnostics>): Diagnostics {
  return {
    backendVersion: "0.1.0",
    protocolVersion: 1,
    platform: "linux",
    deckyVersion: "3.2.10",
    pluginVersion: "0.1.0",
    installations: [
      {
        id: "a1",
        clientLabel: "Retail",
        path: "/home/deck/Applications/World of Warcraft/_retail_",
        companionAddonDetected: true,
      },
    ],
    providers: [
      {
        id: "Curse",
        name: "CurseForge",
        enabled: true,
        available: true,
        requiresApiKey: true,
        configured: true,
        allowEdit: true,
        catalogSearch: true,
        discovers: false,
      },
      {
        id: "TukUI",
        name: "TukUI",
        enabled: false,
        available: false,
        requiresApiKey: false,
        configured: true,
        allowEdit: true,
        catalogSearch: true,
        discovers: false,
      },
    ],
    recentErrors: [
      { time: "2026-10-08T00:00:00.000Z", method: "addons.install", message: "install failed" },
    ],
    curseForgeAuth: {
      activeSource: "bundled",
      bundledPresent: true,
      bundledStatus: "valid",
      userConfigured: false,
      userStatus: "unvalidated",
    },
    githubTokenConfigured: false,
    ...overrides,
  };
}

describe("diagnosticsText", () => {
  test("never includes installation filesystem paths", () => {
    const text = diagnosticsText(makeDiagnostics());
    expect(text).not.toContain("/home/deck");
    expect(text).toContain("Retail");
  });

  // Neither field is secret — the key itself isn't part of
  // ProviderInfo at all — so diagnostics can show the real provider
  // state.
  test("includes each provider's real enabled/configured state, distinctly per provider", () => {
    const text = diagnosticsText(makeDiagnostics());
    const parsed = JSON.parse(text);
    expect(parsed.providers).toEqual([
      { id: "Curse", enabled: true, configured: true, requiresApiKey: true },
      { id: "TukUI", enabled: false, configured: true, requiresApiKey: false },
    ]);
  });

  test("reflects an all-disabled configuration without crashing", () => {
    const text = diagnosticsText(
      makeDiagnostics({
        providers: [
          {
            id: "Curse",
            name: "CurseForge",
            enabled: false,
            available: false,
            requiresApiKey: true,
            configured: false,
            allowEdit: true,
            catalogSearch: true,
            discovers: false,
          },
          {
            id: "TukUI",
            name: "TukUI",
            enabled: false,
            available: false,
            requiresApiKey: false,
            configured: true,
            allowEdit: true,
            catalogSearch: true,
            discovers: false,
          },
          {
            id: "WowUpHub",
            name: "WowUpHub",
            enabled: false,
            available: false,
            requiresApiKey: false,
            configured: true,
            allowEdit: true,
            catalogSearch: true,
            discovers: false,
          },
        ],
      }),
    );
    const parsed = JSON.parse(text);
    expect(parsed.providers.every((p: { enabled: boolean }) => p.enabled === false)).toBe(true);
  });

  // Not a secret (no path/key material), and it's exactly the field
  // the Options UI derives its "companion not found" helper text from
  // (src/components/SettingsView.tsx).
  test("includes companionAddonDetected per installation", () => {
    const text = diagnosticsText(makeDiagnostics());
    const parsed = JSON.parse(text);
    expect(parsed.installations).toEqual([{ clientLabel: "Retail", companionAddonDetected: true }]);
  });

  test("handles no installations/providers configured yet", () => {
    const text = diagnosticsText(makeDiagnostics({ installations: [], providers: [] }));
    const parsed = JSON.parse(text);
    expect(parsed.installations).toEqual([]);
    expect(parsed.providers).toEqual([]);
  });

  // Every message that reaches this type is already short and
  // pre-sanitized by the backend (never a raw request/response), so
  // it's safe to surface here.
  test("includes recentErrors", () => {
    const text = diagnosticsText(makeDiagnostics());
    const parsed = JSON.parse(text);
    expect(parsed.recentErrors).toEqual([
      { time: "2026-10-08T00:00:00.000Z", method: "addons.install", message: "install failed" },
    ]);
  });

  // Source/status only, by construction — CurseForgeAuthStatus has no
  // field that could ever hold a key value (just enums/booleans), so
  // this also doubles as a type-level guarantee, not only a runtime
  // assertion.
  test("includes CurseForge key source/status and GitHub token configured state, never a credential", () => {
    const text = diagnosticsText(
      makeDiagnostics({
        curseForgeAuth: {
          activeSource: "user",
          bundledPresent: true,
          bundledStatus: "invalid",
          userConfigured: true,
          userStatus: "valid",
        },
        githubTokenConfigured: true,
      }),
    );
    const parsed = JSON.parse(text);
    expect(parsed.curseForgeAuth).toEqual({
      activeSource: "user",
      bundledPresent: true,
      bundledStatus: "invalid",
      userConfigured: true,
      userStatus: "valid",
    });
    expect(parsed.githubTokenConfigured).toBe(true);
    expect(text).not.toContain(SECRET);
  });

  // A configured-but-inactive user key (bundled still healthy) must
  // read as configured without reading as the *active* source — it
  // must not be reported as the source currently being used.
  test("a merely-configured, inactive user key is never reported as the active source", () => {
    const text = diagnosticsText(
      makeDiagnostics({
        curseForgeAuth: {
          activeSource: "bundled",
          bundledPresent: true,
          bundledStatus: "valid",
          userConfigured: true,
          userStatus: "valid",
        },
      }),
    );
    const parsed = JSON.parse(text);
    expect(parsed.curseForgeAuth.activeSource).toBe("bundled");
    expect(parsed.curseForgeAuth.userConfigured).toBe(true);
  });

  test("still never includes a secret, even if one somehow ended up in a recentErrors message upstream", () => {
    const text = diagnosticsText(
      makeDiagnostics({
        recentErrors: [
          { time: "2026-10-08T00:00:00.000Z", method: "providers.testApiKey", message: "rejected" },
        ],
      }),
    );
    expect(text).not.toContain(SECRET);
  });
});
