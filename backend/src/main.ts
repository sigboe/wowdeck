/**
 * Engine entry point and composition root.
 *
 * Wires the JSONL RPC server to the addon services. All logging goes to
 * stderr (stdout is the protocol stream).
 */

import { tmpdir } from "node:os";
import { version } from "../package.json";
import { join } from "node:path";
import type { OperationProgress, OperationResult } from "./api/contracts";
import { JsonlServer } from "./bridge/jsonl";
import { createStateStore } from "./wow/storage/StateStore";
import { NetworkClient } from "./wow/net/network";
import { ProviderRegistry } from "./wow/providers/provider-registry";
import { WowUpHubProvider } from "./wow/providers/wowup-hub/WowUpHubProvider";
import { TukUiAddonProvider } from "./wow/providers/tukui/TukUiAddonProvider";
import { CurseForgeProvider } from "./wow/providers/curseforge/CurseForgeProvider";
import { GitHubProvider } from "./wow/providers/github/GitHubProvider";
import { WowInterfaceProvider } from "./wow/providers/wowinterface/WowInterfaceProvider";
import { ZipProvider } from "./wow/providers/zip/ZipProvider";
import { FileProvider } from "./wow/providers/file/FileProvider";
import { DownloadService } from "./wow/downloads/DownloadService";
import { AddonService } from "./wow/addons/AddonService";
import { getGameTypeForClientType } from "./wow/utils/gametype";
import { RecentErrorsBuffer } from "./diagnostics/RecentErrors";
import { CompanionSyncCoordinator } from "./wow/notifications/CompanionSync";
import { UpdateToastGate } from "./wow/notifications/UpdateToastGate";
import { UpdateCheck } from "./wow/notifications/UpdateCheck";
import { PluginUpdateCheck } from "./wow/notifications/PluginUpdateCheck";
import { UpdateStager } from "./wow/plugin/UpdateStager";
import { CurseForgeAuthService } from "./wow/providers/curseforge/CurseForgeKeyAuth";
import { WtfBackupService } from "./wow/wtf/WtfBackupService";
import { WtfJobRunner, type WtfJobTarget } from "./wow/wtf/WtfJobRunner";
import { flavorKeyFor, wtfPathFor } from "./wow/wtf/WtfPaths";
import type { HandlerDeps } from "./api/handlers/deps";
import { register as registerAddons } from "./api/handlers/addons";
import { register as registerInstallations } from "./api/handlers/installations";
import { register as registerNotifications } from "./api/handlers/notifications";
import { register as registerProviders } from "./api/handlers/providers";
import { register as registerSettings } from "./api/handlers/settings";
import { register as registerSystem } from "./api/handlers/system";
import { register as registerWtf } from "./api/handlers/wtf";

/** Bundled into the binary from backend/package.json at build time. */
const BACKEND_VERSION = version;
/** The WowUp Hub's API and its addon pages share one host (tests point both at a mock). */
const HUB_URL = process.env.WOWDECK_HUB_URL ?? "https://hub.wowup.io";
/** WoWDeck's own update check (tests point it at the mock hub too). */
const RELEASES_URL = process.env.WOWDECK_RELEASES_URL ?? "https://api.github.com/repos/sigboe/wowdeck/releases/latest";

const dataDir = process.env.WOWDECK_DATA_DIR ?? join(tmpdir(), "wowdeck");
const homeDir = process.env.HOME ?? "/home/deck";

const store = createStateStore(dataDir);
const network = new NetworkClient();
const registry = new ProviderRegistry();
registry.register(new WowUpHubProvider(HUB_URL, HUB_URL, network));
registry.register(new TukUiAddonProvider(network));

/**
 * The bundled CurseForge key arrives only as this env var (main.py reads the
 * packaged resource and sets it; docs/curseforge-api-key.md). Absent in forks
 * and dev builds: a supported state, not an error (CurseForgeAuthService).
 */
const bundledCurseForgeKey = process.env.WOWDECK_BUNDLED_CURSEFORGE_API_KEY?.trim() || undefined;
const curseForgeAuth = new CurseForgeAuthService(bundledCurseForgeKey, () => store.settings.curseApiKey ?? undefined);
const curseForgeProvider = new CurseForgeProvider(
  network,
  () => curseForgeAuth.activeKey(),
  // Unset: the provider's own default API address.
  process.env.WOWDECK_CF_URL,
  (err) => curseForgeAuth.recordNormalOutcome(err),
);
registry.register(curseForgeProvider);
registry.register(new GitHubProvider(network, () => store.settings.githubAccessToken ?? undefined));
registry.register(new WowInterfaceProvider(network));
registry.register(new ZipProvider());
registry.register(new FileProvider());
registry.attachStore(store);

// One dedicated health check at startup, not on every screen open —
// fire-and-forget so a slow/unreachable CurseForge never delays the
// engine answering its first RPC. Bundled-key status starts
// "unvalidated" (a real, reportable state) until this resolves.
void curseForgeAuth.recheck((key) => curseForgeProvider.testApiKey(key));

const recentErrors = new RecentErrorsBuffer();

const downloadDir = join(dataDir, "downloads");
const service = new AddonService(
  store,
  registry,
  new DownloadService(network, downloadDir),
  {
    addonsChanged: (addonIds) => {
      server.emit("addons.changed", { addonIds });
      // Addon install/update/remove/ignore state changes only need a
      // cheap, local-only regen (no network) — safe to run on every
      // addon-state change regardless of which installation it touched.
      // See CompanionSyncCoordinator's own doc comment for why this is
      // always the cheap path, never the network-refreshing one.
      void companionCoordinator.regenerate();
    },
    operationProgress: (progress: OperationProgress) => server.emit("operation.progress", { progress }),
    autoUpdated: (result) => server.emit("addons.autoUpdated", { result }),
    operationResult: (result: OperationResult) => {
      server.emit(result.status === "failed" ? "operation.failed" : "operation.completed", { result });
      // Surface recent failures in diagnostics — result.error is
      // already a short, pre-sanitized message (see AddonService's
      // existing error handling), never raw request/response bodies or
      // secrets.
      if (result.status === "failed" && result.error) {
        recentErrors.record(result.addonId ? `addon:${result.addonId}` : "addons.operation", result.error);
      }
    },
  },
  // Previews unpack into the plugin's own data dir (like downloads), not
  // tmp: a big archive on the Deck must not land on a RAM-backed tmpfs.
  undefined,
  join(dataDir, "inspect"),
);
const installationService = service.installations;
const companionCoordinator = new CompanionSyncCoordinator(service);
const updateCheck = new UpdateCheck(service, companionCoordinator);
const updateToastGate = new UpdateToastGate(service, store, updateCheck);
const pluginUpdate = new PluginUpdateCheck(
  network,
  BACKEND_VERSION,
  RELEASES_URL,
  // The addon source's token, read live: a token saved later in the session
  // is picked up by the next daily check.
  () => store.settings.githubAccessToken ?? undefined,
  // The once-a-day cap and the failure backoff live in settings, so a
  // restart inside the interval answers from the stored answer instead of
  // asking GitHub again, and a restarted engine still honours a backoff
  // window opened before it. The same store holds the toast gate's
  // shown-version mark (toastPending), so the once-per-release-version
  // promise survives engine restarts too.
  {
    read: () => store.settings.lastPluginUpdate,
    write: (snapshot) => store.updateSettings({ lastPluginUpdate: snapshot }),
    readBackoff: () => store.settings.pluginUpdateBackoff,
    writeBackoff: (backoff) => store.updateSettings({ pluginUpdateBackoff: backoff }),
    readToastShown: () => store.settings.pluginUpdateToastShownFor,
    writeToastShown: (version) => store.updateSettings({ pluginUpdateToastShownFor: version }),
  },
);

const updateStager = new UpdateStager(network, pluginUpdate, () => store.settings.githubAccessToken ?? undefined);

const server = new JsonlServer();

const wtfService = new WtfBackupService({
  backupRoot: () => {
    const custom = store.settings.wtfBackupDir;
    return custom ? { path: custom, custom: true } : { path: join(dataDir, "wtf-backups"), custom: false };
  },
  pluginVersion: () => process.env.DECKY_PLUGIN_VERSION,
  deviceId: () => store.deviceId(),
  keepSnapshots: () => store.settings.wtfKeepSnapshots,
});
const wtfJobs = new WtfJobRunner(wtfService, {
  progress: (payload) => server.emit("wtf.progress", payload),
  completed: (payload) => server.emit("wtf.completed", payload),
  failed: (code, message) => recentErrors.record("wtf", `${code}: ${message}`),
});

function wtfJobTarget(installationId?: string): WtfJobTarget {
  const installation = installationService.require(installationId);
  return {
    installationId: installation.id,
    flavor: flavorKeyFor(installation.location, getGameTypeForClientType(installation.clientType)),
    wtfPath: wtfPathFor(installation.location),
  };
}

const deps: HandlerDeps = {
  backendVersion: BACKEND_VERSION,
  homeDir,
  store,
  registry,
  service,
  installationService,
  companionCoordinator,
  updateCheck,
  updateToastGate,
  pluginUpdate,
  updateStager,
  curseForgeAuth,
  curseForgeProvider,
  wtfService,
  wtfJobs,
  wtfJobTarget,
  recentErrors,
};
for (const register of [
  registerSystem,
  registerInstallations,
  registerAddons,
  registerProviders,
  registerSettings,
  registerWtf,
  registerNotifications,
]) {
  register(server, deps);
}

console.error(`[engine] wowdeck backend ${BACKEND_VERSION} starting (pid ${process.pid})`);
console.error(`[engine] data dir: ${dataDir}`);
// No unconditional startup refresh here — "plugin loads" is owned by
// the frontend's own call to notifications.checkUpdateToast
// (src/index.tsx), which runs the same all-installations refresh but
// rate-limited to once a day.
// Heal anything an interrupted backup/restore left behind (engine killed mid-job, power loss, sleep) before
// the first request is served. Never fatal.
try {
  const swept = await wtfService.sweepPartials();
  for (const installation of installationService.list()) {
    const { restoredPreviousWtf } = await wtfService.recover(wtfJobTarget(installation.id));
    if (restoredPreviousWtf) {
      console.error(`[wtf] restored the previous WTF folder of ${installation.displayName} after an interrupted restore`);
      recentErrors.record("wtf", "recovered: an interrupted restore was rolled back");
    }
  }
  if (swept > 0) {
    console.error(`[wtf] removed ${swept} unfinished backup file(s)`);
  }
} catch (err) {
  console.error(`[wtf] startup recovery failed: ${String(err)}`);
}

await server.run();
