/**
 * An AddonService wired to its installation module as engine.ts wires it:
 * removing an installation runs as a guarded turn of the service's gate.
 */
import { AddonService, type ServiceEvents } from "../../src/wow/addons/AddonService";
import type { DownloadService } from "../../src/wow/downloads/DownloadService";
import { InstallationService } from "../../src/wow/installation/InstallationService";
import type { ProviderRegistry } from "../../src/wow/providers/provider-registry";
import type { StateStore } from "../../src/wow/storage/StateStore";

export function addonService(
  store: StateStore,
  registry: ProviderRegistry,
  downloads: DownloadService,
  events: ServiceEvents,
  inspectRoot?: string,
): AddonService {
  const installations: InstallationService = new InstallationService(
    store,
    (id, removeEntry): Promise<void> => service.removeInstallation(id, removeEntry),
    () => events.addonsChanged([]),
  );
  const service: AddonService = new AddonService(store, registry, downloads, events, installations, inspectRoot);
  return service;
}
