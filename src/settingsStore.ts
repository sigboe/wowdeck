import type { PluginSettings } from "./types";
import { createStore, type Store } from "./store";
import { errorText } from "./errors";
import { defaultSettings } from "../backend/src/wow/storage/settings";

/**
 * The plugin settings as the UI shows them: one copy, loaded at plugin start
 * and replaced by every `settings.set` answer (normalized by the engine,
 * tokens redacted). The engine's defaults until the first load.
 */
export interface SettingsState {
  settings: PluginSettings;
  /** The engine answered at least once (rows that must not show a default can wait for it). */
  loaded: boolean;
}

export interface SettingsDeps {
  get(): Promise<PluginSettings>;
  set(patch: Partial<PluginSettings>): Promise<PluginSettings>;
  toast(title: string, body: string): void;
}

export interface SettingsStore extends Pick<Store<SettingsState>, "get" | "subscribe"> {
  /** Read the engine's settings; an engine that is not ready keeps what is shown. */
  load(): Promise<void>;
  /** Save and show the engine's answer; throws on failure, the store unchanged. */
  write(patch: Partial<PluginSettings>): Promise<PluginSettings>;
  /**
   * A toggle or picker: shown at once, then the engine's answer. A failure
   * puts the sent keys back and toasts "Couldn't save"; `saved` is toasted on
   * success. Resolves to whether it was saved.
   */
  save(patch: Partial<PluginSettings>, saved?: [title: string, body: string]): Promise<boolean>;
}

export function createSettingsStore(deps: SettingsDeps): SettingsStore {
  const store = createStore<SettingsState>({ settings: defaultSettings(), loaded: false });
  const replace = (settings: PluginSettings) => store.set({ settings, loaded: true });
  const write = async (patch: Partial<PluginSettings>) => {
    const settings = await deps.set(patch);
    replace(settings);
    return settings;
  };
  return {
    get: store.get,
    subscribe: store.subscribe,
    async load() {
      try {
        replace(await deps.get());
      } catch {
        // engine not ready
      }
    },
    write,
    async save(patch, saved) {
      const before = store.get().settings;
      store.patch({ settings: { ...before, ...patch } });
      try {
        await write(patch);
      } catch (e) {
        // Only the keys this save sent: another save may have landed meanwhile.
        const restored = { ...store.get().settings };
        for (const key of Object.keys(patch) as Array<keyof PluginSettings>) {
          (restored as Record<string, unknown>)[key] = before[key];
        }
        store.patch({ settings: restored });
        deps.toast("Couldn't save", errorText(e));
        return false;
      }
      if (saved) {
        deps.toast(saved[0], saved[1]);
      }
      return true;
    },
  };
}
