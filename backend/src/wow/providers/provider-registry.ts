/** Registry of available addon providers (replaces WowUp's factory service). */

import type { AddonProvider } from "./addon-provider";
import type { StateStore } from "../storage/StateStore";
import type { ProviderInfo } from "../../api/contracts";
import { NotFoundError, ValidationError } from "../errors";
import { providerDisplayName } from "../../api/providers";

function isUsable(provider: AddonProvider): boolean {
  return provider.enabled && provider.isConfigured();
}

export class ProviderRegistry {
  #providers = new Map<string, AddonProvider>();
  #store: StateStore | null = null;

  register(provider: AddonProvider): void {
    this.#providers.set(provider.name, provider);
    if (this.#store) {
      this.applyStoredState(provider);
    }
  }

  /** Wire persistence; stored enabled-state wins over provider defaults. */
  attachStore(store: StateStore): void {
    this.#store = store;
    for (const provider of this.#providers.values()) {
      this.applyStoredState(provider);
    }
  }

  /**
   * Re-evaluate provider defaults (used when configuration changes, e.g.
   * an API key was added). Explicit user choices (stored lists) win.
   */
  refreshDefaults(): void {
    for (const provider of this.#providers.values()) {
      this.applyStoredState(provider);
    }
  }

  get(name: string): AddonProvider | undefined {
    return this.#providers.get(name);
  }

  all(): AddonProvider[] {
    return [...this.#providers.values()];
  }

  enabled(): AddonProvider[] {
    return this.all().filter((p) => p.enabled);
  }

  /**
   * The one test for "this provider can be used now": enabled AND
   * configured. "Enabled but unconfigured" (an auth provider with no key)
   * is a real, displayable state (the Sources toggle), but every use
   * would just fail: search, scan, update checks, install, update,
   * import. Every caller asks here; the UI gets the answer as
   * ProviderInfo.available.
   */
  usable(name: string | undefined): AddonProvider | undefined {
    const provider = name === undefined ? undefined : this.#providers.get(name);
    return provider && isUsable(provider) ? provider : undefined;
  }

  /** Every usable provider (see usable()). */
  available(): AddonProvider[] {
    return this.all().filter(isUsable);
  }

  /**
   * Enable/disable a provider and persist the choice (settings
   * `enabledProviders`: null = provider defaults, otherwise the list of
   * enabled provider ids). Mirrors WowUp's per-provider addon_providers
   * preference (wowup.service.ts L228-247).
   *
   * Refuses a provider where `allowEdit` is false (GitHub) —
   * matches upstream's own `setProviderEnabled()`, which throws under
   * the identical condition rather than silently flipping a provider the
   * UI never even shows a toggle for.
   */
  setEnabled(name: string, enabled: boolean): ProviderInfo[] {
    const provider = this.#providers.get(name);
    if (!provider) {
      throw new NotFoundError("provider", name);
    }
    if (!provider.allowEdit) {
      throw new ValidationError(`${name} cannot be enabled or disabled`);
    }
    provider.enabled = enabled;
    if (this.#store) {
      const current = this.#store.settings.enabledProviders;
      const list = new Set(current ?? this.#providers.keys());
      if (enabled) {
        list.add(name);
      } else {
        list.delete(name);
      }
      this.#store.updateSettings({ enabledProviders: [...list] });
    }
    return this.providerInfos();
  }

  providerInfos(): ProviderInfo[] {
    return this.all().map((p) => ({
      id: p.name,
      name: providerDisplayName(p.name),
      enabled: p.enabled,
      available: isUsable(p),
      requiresApiKey: p.authRequired,
      configured: p.isConfigured(),
      allowEdit: p.allowEdit,
      catalogSearch: p.catalogSearch,
      discovers: p.discovers,
    }));
  }

  /**
   * A provider with `allowEdit === false` (GitHub) must stay
   * enabled regardless of any persisted `enabledProviders` list — even a
   * stale list from before this provider existed, or one written by a
   * future bug. This is checked before the stored-list lookup, not
   * folded into it, so it can never be bypassed by that list's contents.
   */
  private applyStoredState(provider: AddonProvider): void {
    if (!provider.allowEdit) {
      return;
    }
    const stored = this.#store!.settings.enabledProviders;
    if (stored !== null) {
      provider.enabled = stored.includes(provider.name);
      return;
    }
    // No explicit user choice yet: auth providers follow their
    // configuration state (API key present -> enabled); everything else
    // keeps its constructor default.
    if (provider.authRequired) {
      provider.enabled = provider.isConfigured();
    }
  }
}
