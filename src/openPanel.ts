import { Navigation, QuickAccessTab } from "@decky/ui";
// Decky's plugin name (plugin.json); Decky's state identifies the active plugin by it.
import { name as PLUGIN_NAME } from "../plugin.json";
import { qamState, type QamTab } from "./qamState";

/** Opens the Quick Access menu on our panel, at `tab`. */
export function openPanel(tab: QamTab): void {
  qamState.tab = tab;
  Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);
  try {
    // Decky's own state: show our panel rather than the last one used.
    (
      window as { DeckyPluginLoader?: { deckyState?: { setActivePlugin?: (n: string) => void } } }
    ).DeckyPluginLoader?.deckyState?.setActivePlugin?.(PLUGIN_NAME);
  } catch {
    // The QAM still opens on the Decky tab.
  }
}
