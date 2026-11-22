import { systemClock } from "./clock";
import { engine } from "./engineLink";
import { createKeyedResource } from "./keyedResource";
import type { InstallationRecoveryDetails } from "./types";
import { useResource } from "./useResource";

const details = createKeyedResource<InstallationRecoveryDetails>({
  read: (installationId) => engine.rpc("installations.recoveryDetails", { installationId }),
  errorText: (e) => (e instanceof Error ? e.message : String(e)),
  clock: systemClock,
});

/** What the engine says is kept where for one installation; `refresh` reads again after Retry or Verify. */
export const useRecoveryDetails = (installationId: string) => useResource(details, installationId);

/** Forget an installation's details (its modal closed), so the next one starts empty. */
export const forgetRecoveryDetails = (installationId: string) => details.forget(installationId);
