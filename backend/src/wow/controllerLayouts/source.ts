/**
 * The Controller layouts source's gate: whether the source is on
 * (`controllerLayoutsEnabled`, whose contract says what Off stops). The
 * controllerLayouts.catalogue handler checks it before every fetch.
 */

import type { PluginSettings } from "../../api/contracts";

export function controllerLayoutsSourceEnabled(settings: Pick<PluginSettings, "controllerLayoutsEnabled">): boolean {
  return settings.controllerLayoutsEnabled;
}
