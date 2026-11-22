import { act } from "react";
import type { PluginSettings } from "../../backend/src/api/contracts";
import type { SettingsStore } from "../settingsStore";
import type { FakeEngine } from "./fakeEngine";

/**
 * An Options toggle: `store.save` shows the change at once, then the fake
 * engine answers `settings.set` with it. The store is passed in, so a test
 * imports it after its own module mocks.
 */
export async function saveSetting(
  store: SettingsStore,
  fake: FakeEngine,
  patch: Partial<PluginSettings>,
): Promise<void> {
  let saved: Promise<unknown> | undefined;
  await act(async () => {
    saved = store.save(patch);
  });
  const settings = { ...store.get().settings, ...patch };
  await act(async () => fake.next("settings.set").resolve({ settings }));
  await act(async () => saved);
}
