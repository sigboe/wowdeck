import { createStore } from "./store";
import type { Rpc } from "./services/envelope";
import type { ProviderCategory, ProviderInfo } from "./types";

/**
 * The addon sources (`providers.list`) and their categories
 * (`addons.getCategories`), shared by Get Addons and Options and kept at
 * module scope: a remount (every modal and menu, guide G4) renders the last
 * list at once while a fresh load is on its way, and a source turned off in
 * Options is off in Get Addons too. Reference data: another installation
 * keeps it.
 */
export interface SourcesState {
  /** Null until a load has succeeded (Options then offers Try again). */
  providers: ProviderInfo[] | null;
  /** A load has ended, answered or not: the capability decision is final. */
  loaded: boolean;
  /**
   * The categories by source id. A source that answered with none —
   * unsupported (null) or an empty list — is kept as `[]`: it is not
   * category-capable, and Popular's Category segment stays away (ADR 0002).
   */
  categories: Readonly<Record<string, ProviderCategory[]>>;
}

const initial = (): SourcesState => ({ providers: null, loaded: false, categories: {} });

export const sourcesStore = createStore<SourcesState>(initial());

/** Category lookups on their way, so a source is asked once. */
const asking = new Set<string>();

/** Back to nothing loaded (tests). */
export function resetSourcesStore(): void {
  asking.clear();
  sourcesStore.set(initial());
}

/** Read the sources again; a failure keeps the last list (engine not ready). */
export async function loadSources(rpc: Rpc): Promise<void> {
  try {
    const { providers } = await rpc("providers.list");
    sourcesStore.patch({ providers, loaded: true });
  } catch {
    sourcesStore.patch({ loaded: true });
  }
}

/**
 * Turn a source on or off (Options only, ADR 0002): shown at once, then the
 * engine's answer. A refusal reads the list again and is rethrown for the
 * caller to report.
 */
export async function setSourceEnabled(
  rpc: Rpc,
  providerId: string,
  enabled: boolean,
): Promise<void> {
  const { providers } = sourcesStore.get();
  sourcesStore.patch({
    providers: providers?.map((p) => (p.id === providerId ? { ...p, enabled } : p)) ?? null,
  });
  try {
    const { providers: next } = await rpc("providers.setEnabled", { providerId, enabled });
    sourcesStore.patch({ providers: next });
  } catch (e) {
    await loadSources(rpc);
    throw e;
  }
}

/** Ask for a source's categories, once; a failed ask is not kept, so the next one asks again. */
export async function loadCategories(rpc: Rpc, providerId: string): Promise<void> {
  if (sourcesStore.get().categories[providerId] || asking.has(providerId)) {
    return;
  }
  asking.add(providerId);
  try {
    const { categories } = await rpc("addons.getCategories", { providerId });
    sourcesStore.patch({
      categories: { ...sourcesStore.get().categories, [providerId]: categories ?? [] },
    });
  } catch {
    // not kept: asked again on the next sources change or remount
  } finally {
    asking.delete(providerId);
  }
}
