import type { Diagnostics } from "./types";

/**
 * The fields surfaced in the copyable diagnostics text. Deliberately
 * excludes `Installation.path` (local filesystem layout) and anything
 * that could carry API key/token material — diagnostics must never
 * expose those.
 *
 * `enabled`/`configured`/`requiresApiKey` on `ProviderInfo` are NOT
 * secrets (the key itself is never part of this type at all — see
 * backend/src/api/contracts.ts), so they're safe to include and are
 * exactly what diagnostics needs to show whether a provider is enabled
 * (registry.providerInfos() is the source of truth — see
 * provider-registry.ts).
 *
 * `recentErrors` is included too — every message that reaches here is
 * already a short, pre-sanitized string (NetworkError redacts URLs;
 * ProviderError messages are hand-written), never a raw
 * request/response body.
 *
 * Pulled out of SettingsView so this allowlist is unit-testable without
 * pulling in @decky/ui.
 *
 * `curseForgeAuth`/`githubTokenConfigured` are included too — both are
 * source/status-only (see CurseForgeAuthStatus and contracts.ts's own
 * doc comments), never a key or token value, a prefix/suffix of one, or
 * any encoded/hashed form of one.
 */
export function diagnosticsText(diagnostics: Diagnostics): string {
  return JSON.stringify(
    {
      backendVersion: diagnostics.backendVersion,
      deckyVersion: diagnostics.deckyVersion,
      pluginVersion: diagnostics.pluginVersion,
      platform: diagnostics.platform,
      installations: diagnostics.installations.map((i) => ({
        clientLabel: i.clientLabel,
        companionAddonDetected: i.companionAddonDetected,
      })),
      providers: diagnostics.providers.map((p) => ({
        id: p.id,
        enabled: p.enabled,
        configured: p.configured,
        requiresApiKey: p.requiresApiKey,
      })),
      recentErrors: diagnostics.recentErrors,
      curseForgeAuth: diagnostics.curseForgeAuth,
      githubTokenConfigured: diagnostics.githubTokenConfigured,
    },
    null,
    2,
  );
}
