/** Run as an awaited expression in Steam's existing CEF page. Read-only.
 * No editor loads, previews, exports, selection setters or callback registration.
 * Returns local evidence; do not publish account identifiers or raw source URLs.
 */
(async () => {
  const store = globalThis.controllerConfiguratorStore;
  const input = globalThis.SteamClient?.Input;
  if (!store || typeof input?.GetConfigForAppAndController !== "function")
    throw Error("Open the existing controller settings page first");
  // This field is populated by DoControllerListQuery in the recorded installed
  // source. Missing/changed shape is evidence to collect, never an empty proof.
  const controllers = store.m_controllerList;
  if (!Array.isArray(controllers) || controllers.length > 16)
    throw Error("Controller inventory unavailable");
  const apps = globalThis.appStore?.allApps;
  if (!Array.isArray(apps)) throw Error("Library inventory unavailable");
  const shortcuts = apps.filter(a => a.app_type === 1073741824);
  if (shortcuts.length * controllers.length > 1000) throw Error("Library inventory exceeds probe bound");
  const deadline = Date.now() + 30000;
  const readSelection = async (appId, index) => {
    let timer;
    try {
      const remaining = Math.min(5000, deadline - Date.now());
      if (remaining <= 0) throw Error("Probe time bound exceeded; inventory incomplete");
      return await Promise.race([input.GetConfigForAppAndController(appId, index),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Native read timed out; inventory incomplete")), remaining); })]);
    } finally { clearTimeout(timer); }
  };
  const result = [];
  for (const controller of controllers) {
    const index = controller.nControllerIndex;
    if (!Number.isSafeInteger(index)) throw Error("Invalid controller index");
    const selections = [];
    for (const app of shortcuts) {
      const selection = await readSelection(app.appid, index);
      // Winning selection only. Does not establish absence in the other layer.
      selections.push({ appId: app.appid, name: app.display_name, selection });
    }
    result.push({ controller: {
      index, type: controller.eControllerType,
      hasSerial: !!controller.strSerialNumber, hasChipID: !!controller.strChipID,
      // Record stable digests rather than publishing the physical serial.
      identity: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
        new TextEncoder().encode(JSON.stringify([controller.strSerialNumber, controller.strChipID])))),
        b => b.toString(16).padStart(2, "0")).join(""),
    }, selections });
  }
  return { editingController: store.EditingConfigurationControllerIndex,
    selectionType: store.m_eConfigSelectionType, result,
    limitation: "Winning selections cannot prove both override layers or cross-name isolation" };
})()
