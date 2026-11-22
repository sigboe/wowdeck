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
  /**
   * Read the engine's settings; an engine that is not ready keeps what is
   * shown, and so does an answer a write sent meanwhile made out of date.
   */
  load(): Promise<void>;
  /**
   * Save and show the engine's answer (unless a newer write was sent since);
   * throws on failure, the store unchanged.
   */
  write(patch: Partial<PluginSettings>): Promise<PluginSettings>;
  /**
   * A toggle or picker: shown at once, then the engine's answer, the newest
   * save winning. A failure puts back the sent keys no newer save sent and
   * toasts "Couldn't save"; `saved` is toasted on success. Resolves to
   * whether it was saved.
   */
  save(patch: Partial<PluginSettings>, saved?: [title: string, body: string]): Promise<boolean>;
}

export function createSettingsStore(deps: SettingsDeps): SettingsStore {
  const store = createStore<SettingsState>({ settings: defaultSettings(), loaded: false });
  const replace = (settings: PluginSettings) => store.set({ settings, loaded: true });
  /**
   * Writes are numbered as they are sent. The engine applies them in that
   * order, so the newest write's answer holds every earlier one: an answer
   * (or a read) older than the newest write is out of date and dropped.
   */
  let newest = 0;
  /** Per key, the newest write that sent it: a failed write restores only keys no newer write sent. */
  const lastWriteOf = new Map<keyof PluginSettings, number>();
  /** Number a write about to be sent. */
  const begin = (patch: Partial<PluginSettings>) => {
    newest += 1;
    for (const key of Object.keys(patch) as Array<keyof PluginSettings>) {
      lastWriteOf.set(key, newest);
    }
    return newest;
  };
  /** Show an answer unless a newer write was sent since. */
  const answered = (seq: number, settings: PluginSettings) => {
    if (seq === newest) {
      replace(settings);
    }
    return settings;
  };
  const write = async (patch: Partial<PluginSettings>) => {
    const seq = begin(patch);
    return answered(seq, await deps.set(patch));
  };
  return {
    get: store.get,
    subscribe: store.subscribe,
    async load() {
      // A write sent meanwhile reached the engine first: its answer is newer.
      const seen = newest;
      try {
        const settings = await deps.get();
        if (seen === newest) {
          replace(settings);
        }
      } catch {
        // engine not ready
      }
    },
    write,
    async save(patch, saved) {
      const before = store.get().settings;
      store.patch({ settings: { ...before, ...patch } });
      const seq = begin(patch);
      try {
        answered(seq, await deps.set(patch));
      } catch (e) {
        // Only the keys this save sent, and only those no newer save sent.
        const restored = { ...store.get().settings };
        for (const key of Object.keys(patch) as Array<keyof PluginSettings>) {
          if (lastWriteOf.get(key) === seq) {
            (restored as Record<string, unknown>)[key] = before[key];
          }
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
