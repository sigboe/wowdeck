/**
 * Whether the Controller layouts source is on (Options › Sources). The one
 * gate the catalogue fetch and the Controller layouts destination check:
 * while it is off, neither runs. Turning it off undoes nothing; controls
 * already applied stay as they are.
 */

import type { PluginSettings } from "../../api/contracts";

export function controllerLayoutsSourceEnabled(settings: Pick<PluginSettings, "controllerLayoutsEnabled">): boolean {
  return settings.controllerLayoutsEnabled;
}
