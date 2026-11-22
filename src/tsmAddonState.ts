import { createStore } from "./store";

// Steam modals unmount their opener (G4/P6). Keep each installation's
// operation and result available to the panel that returns.
interface TsmAddonState {
  busy: boolean;
  error?: string;
}
const installations = new Map<string, ReturnType<typeof createStore<TsmAddonState>>>();
export function tsmAddonState(installationId: string) {
  let state = installations.get(installationId);
  if (!state) {
    state = createStore<TsmAddonState>({ busy: false });
    installations.set(installationId, state);
  }
  return state;
}
