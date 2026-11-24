import { InstallationDetector } from "./wow/installation/InstallationDetector";
import { LaunchService, type LaunchWorld } from "./wow/launch/LaunchService";
import { localLaunchWorld } from "./wow/launch/LaunchProcesses";
import { resolveLaunchEntry } from "./wow/launch/LaunchEntries";
import { LinkedGameList } from "./wow/installation/LinkedGames";
import { detectPlayOwner } from "./wow/launch/PlayOwner";
/**
 * The engine's assembly: every service the RPC handlers use, wired from one
 * configuration, and the startup that runs before the first request.
 *
 * main.ts maps the environment to an EngineConfig (configFromEnv) and runs
 * it. Tests build the same engine in-process with their own folders,
 * network client and clock, and call methods through the contract.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MethodMap, MethodName, OperationResult } from "./api/contracts";
import { JsonlServer } from "./bridge/jsonl";
import { createStateStore } from "./wow/storage/StateStore";
import type { StageFs } from "./wow/fs/StageFs";
import { NetworkClient } from "./wow/net/network";
import { ProviderRegistry } from "./wow/providers/provider-registry";
import { WowUpHubProvider } from "./wow/providers/wowup-hub/WowUpHubProvider";
import { TukUiAddonProvider } from "./wow/providers/tukui/TukUiAddonProvider";
import { CurseForgeProvider } from "./wow/providers/curseforge/CurseForgeProvider";
import { GitHubProvider } from "./wow/providers/github/GitHubProvider";
import { WowInterfaceProvider } from "./wow/providers/wowinterface/WowInterfaceProvider";
import { ZipProvider } from "./wow/providers/zip/ZipProvider";
import { FileProvider } from "./wow/providers/file/FileProvider";
import { CurseForgeAuthService } from "./wow/providers/curseforge/CurseForgeKeyAuth";
import { TradeSkillMasterData } from "./wow/tsm/TradeSkillMasterData";
import { TradeSkillMasterLedgerReader } from "./wow/tsm/Ledger";
import { TradeSkillMasterAuth, TradeSkillMasterProvider } from "./wow/tsm/TradeSkillMasterAuth";
import { DownloadService } from "./wow/downloads/DownloadService";
import { AddonService, type ServiceEvents } from "./wow/addons/AddonService";
import { InstallationService } from "./wow/installation/InstallationService";
import { Catalogue } from "./wow/catalogue/Catalogue";
import { getGameTypeForClientType } from "./wow/utils/gametype";
import { RecentErrorsBuffer } from "./diagnostics/RecentErrors";
import { UpdateToastGate } from "./wow/notifications/UpdateToastGate";
import { AddonUpdates } from "./wow/addons/AddonUpdates";
import { PluginUpdateCheck } from "./wow/notifications/PluginUpdateCheck";
import { UpdateStager } from "./wow/plugin/UpdateStager";
import { PrBuildList } from "./wow/plugin/PrBuildList";
import { PrBuildFollow } from "./wow/plugin/PrBuildFollow";
import { WtfBackupService } from "./wow/wtf/WtfBackupService";
import { WtfJobRunner, type WtfJobTarget } from "./wow/wtf/WtfJobRunner";
import { flavorKeyFor, wtfPathFor } from "./wow/wtf/WtfPaths";
import { About } from "./about/About";
import type { HandlerDeps } from "./api/handlers/deps";
import { handlerTable } from "./api/handlers";

/** Where the engine reaches out. Unset optional ones fall back to each service's own default. */
export interface EngineUrls {
  /** The WowUp Hub's API and its addon pages share one host. */
  hub: string;
  /**
   * WoWDeck's own update check. Must end in `/releases/latest`: the Beta
   * channel lists the releases beside it, and PR state comes from the repo.
   */
  releases: string;
  /**
   * The PR builds list CI publishes on GitHub Pages from the `pr-builds`
   * branch (ADR 0010, docs/development.md "PR builds"); each build's zip
   * must be served from the same host.
   */
  prBuilds: string;
  /** TukUI's catalogue (api.tukui.org when unset). */
  tukui?: string;
  /** CurseForge's API (the provider's own default when unset). */
  curseForge?: string;
  /** The raw base FUNDING.yml and SUPPORTERS.md are fetched from (About's default when unset). */
  about?: string;
}

export interface EngineConfig {
  backendVersion: string;
  /** The plugin's own data folder: state, downloads, previews, default WTF backups. */
  dataDir: string;
  /** The home installation detection scans. */
  homeDir: string;
  urls: EngineUrls;
  /**
   * The bundled CurseForge key (main.py reads the packaged resource;
   * docs/curseforge-api-key.md). Absent in forks and dev builds: a
   * supported state, not an error (CurseForgeAuthService).
   */
  bundledCurseForgeKey?: string;
  /** The installed plugin's folder (main.py passes it); null outside Decky. */
  pluginDir: string | null;
  /** The plugin version Decky reports, recorded in WTF backups. */
  pluginVersion?: string;
  network: NetworkClient;
  now: () => number;
  /** The protocol stream (stdout by default). */
  out?: (line: string) => void;
  /** Process observation and launch asks; this machine's when unset (tests pass fake processes). */
  launchWorld?: LaunchWorld;
  /** The filesystem state writes go through; the real one except in fault-injection tests. */
  fs?: StageFs;
  /**
   * The root DroidDeck's store launcher is looked for under (PlayOwner):
   * `/` when unset, a temporary folder in tests. Nothing else reads it.
   */
  systemRoot?: string;
}

export const DEFAULT_URLS: EngineUrls = {
  hub: "https://hub.wowup.io",
  releases: "https://api.github.com/repos/sigboe/wowdeck/releases/latest",
  prBuilds: "https://sigboe.github.io/wowdeck/index.json",
};

/** The configuration the environment describes (main.py and the integration tests set these). */
export function configFromEnv(env: Record<string, string | undefined>, backendVersion: string): EngineConfig {
  return {
    backendVersion,
    dataDir: env.WOWDECK_DATA_DIR ?? join(tmpdir(), "wowdeck"),
    homeDir: env.HOME ?? "/home/deck",
    urls: {
      hub: env.WOWDECK_HUB_URL ?? DEFAULT_URLS.hub,
      releases: env.WOWDECK_RELEASES_URL ?? DEFAULT_URLS.releases,
      prBuilds: env.WOWDECK_PR_BUILDS_URL ?? DEFAULT_URLS.prBuilds,
      tukui: env.WOWDECK_TUKUI_URL,
      curseForge: env.WOWDECK_CF_URL,
      about: env.WOWDECK_ABOUT_URL,
    },
    bundledCurseForgeKey: env.WOWDECK_BUNDLED_CURSEFORGE_API_KEY?.trim() || undefined,
    pluginDir: env.WOWDECK_PLUGIN_DIR ?? null,
    pluginVersion: env.DECKY_PLUGIN_VERSION,
    network: new NetworkClient(),
    now: Date.now,
  };
}

export interface Engine {
  server: JsonlServer;
  /** What the handlers were registered with. */
  deps: HandlerDeps;
  /** Call a method in-process, as the bridge would (JsonlServer.call). */
  call<K extends MethodName>(method: K, params: MethodMap[K]["params"]): Promise<MethodMap[K]["result"]>;
  /** Answer requests from `input` (stdin by default) until it closes. */
  serve(input?: AsyncIterable<Uint8Array>): Promise<void>;
}

/** The wired engine with nothing started: no scan, no recovery, no network. */
export function assembleEngine(config: EngineConfig): Engine & { start(): Promise<void> } {
  const { backendVersion, dataDir, homeDir, urls, network, now } = config;
  const server = new JsonlServer(config.out);
  const store = createStateStore(dataDir, config.fs);
  /**
   * The optional GitHub token (Options › Addon sources › GitHub), read live: a token saved
   * later in the session is picked up by the next request. The GitHub addon
   * source, the WoWDeck update check, its staging and About all share it.
   */
  const githubToken = (): string | undefined => store.settings.githubAccessToken ?? undefined;

  const registry = new ProviderRegistry();
  registry.register(new WowUpHubProvider(urls.hub, urls.hub, network));
  registry.register(new TukUiAddonProvider(network, urls.tukui));
  const curseForgeAuth = new CurseForgeAuthService(config.bundledCurseForgeKey, () => store.settings.curseApiKey ?? undefined);
  const curseForgeProvider = new CurseForgeProvider(
    network,
    () => curseForgeAuth.activeKey(),
    urls.curseForge,
    (err) => curseForgeAuth.recordNormalOutcome(err),
  );
  registry.register(curseForgeProvider);
  registry.register(new GitHubProvider(network, githubToken));
  registry.register(new WowInterfaceProvider(network));
  registry.register(new ZipProvider());
  registry.register(new FileProvider());
  const tsmAuth = new TradeSkillMasterAuth(dataDir, backendVersion, registry, undefined, undefined, network);
  const tsmProvider = new TradeSkillMasterProvider(tsmAuth);
  registry.register(tsmProvider);
  registry.attachStore(store);

  const recentErrors = new RecentErrorsBuffer();
  const addonEvents: ServiceEvents = {
    addonsChanged: (addonIds) => {
      server.emit("addons.changed", { addonIds });
      // Addon install/update/remove/ignore state changes only need a
      // cheap, local-only regen (no network) — safe to run on every
      // addon-state change regardless of which installation it touched.
      // See CompanionSyncCoordinator's own doc comment for why this is
      // always the cheap path, never the network-refreshing one.
      void companionCoordinator.regenerate();
    },
    operationResult: (result: OperationResult) => {
      // Surface recent failures in diagnostics — result.error is
      // already a short, pre-sanitized message (see AddonService's
      // existing error handling), never raw request/response bodies or
      // secrets. Not emitted on the wire: each action's own answer
      // carries its result.
      if (result.status === "failed" && result.error) {
        recentErrors.record(result.addonId ? `addon:${result.addonId}` : "addons.operation", result.error);
      }
    },
  };
  // Removing an installation is a guarded turn of the addon gate.
  const installationService: InstallationService = new InstallationService(
    store,
    (installationId, removeEntry): Promise<void> => service.removeInstallation(installationId, removeEntry),
    () => addonEvents.addonsChanged([]),
  );
  const service: AddonService = new AddonService(
    store,
    registry,
    new DownloadService(network, join(dataDir, "downloads")),
    addonEvents,
    installationService,
    // Previews unpack into the plugin's own data dir (like downloads), not
    // tmp: a big archive on the Deck must not land on a RAM-backed tmpfs.
    join(dataDir, "inspect"),
  );
  const tsmData = new TradeSkillMasterData(tsmAuth, tsmProvider, installationService, dataDir, (change) => server.emit("tradeskillmaster.changed", change));
  service.onFoldersChanged = (id, folders) => tsmData.foldersChanged(id, folders);
  const catalogue = new Catalogue(registry);
  const addonUpdates = new AddonUpdates(service, registry, store, {
    autoUpdated: (result) => server.emit("addons.autoUpdated", { result }),
    updateAllProgress: (progress) => server.emit("addons.updateAllProgress", progress),
  });
  const companionCoordinator = addonUpdates.companion;
  const updateToastGate = new UpdateToastGate(store, addonUpdates);

  // Reactions, wired here so the handlers only map params to calls.
  // A toggle only changes local state, and eligibility
  // (AddonUpdates.eligibleFor) reads provider.enabled live: a cheap
  // regen, no network call.
  registry.enabledListeners.add(() => void companionCoordinator.regenerate());
  store.settingsListeners.add(async ({ before, after }) => {
    if (after.curseApiKey === before.curseApiKey) return;
    // A newly configured (or removed) API key changes provider defaults.
    registry.refreshDefaults();
    // Re-validate and record the authoritative verdict, independent of
    // whatever Options' own pre-save providers.testApiKey check already
    // showed: this runs right after the new value is persisted (see
    // CurseForgeAuthService.setUserCheckResult on why that matters).
    if (after.curseApiKey) {
      await curseForgeAuth.recheck((key) => curseForgeProvider.testApiKey(key), after.curseApiKey);
    }
  });
  // The fetched files (FUNDING.yml, SUPPORTERS.md) refresh only when the
  // update check below asks GitHub (ADR-0005), with the same optional
  // token, which FetchedFile sends to GitHub hosts only.
  const about = new About({
    pluginDir: config.pluginDir,
    dataDir,
    net: network,
    rawBaseUrl: urls.about,
    tokenProvider: githubToken,
  });
  const prBuilds = new PrBuildList(network, urls.prBuilds);
  // The PR channel's source (GLOSSARY: PR channel). A PR's own state comes from
  // the repo's API, unauthenticated: the repo is public, and no token ever
  // reaches a PR build's check.
  const prBuildFollow = new PrBuildFollow(prBuilds, network, urls.releases.replace(/\/releases\/latest$/, ""));
  const pluginUpdate = new PluginUpdateCheck(
    network,
    backendVersion,
    urls.releases,
    githubToken,
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
      readLastRunVersion: () => store.settings.pluginUpdateLastRunVersion,
      writeLastRunVersion: (version) => store.updateSettings({ pluginUpdateLastRunVersion: version }),
      readStagedVersion: () => store.settings.pluginUpdateStagedVersion,
      writeStagedVersion: (version) => store.updateSettings({ pluginUpdateStagedVersion: version }),
      readChannel: () => store.settings.pluginUpdateChannel,
      writeChannel: (channel) => store.updateSettings({ pluginUpdateChannel: channel }),
      readPrChannel: () => store.settings.pluginUpdatePrChannel,
      writePrChannel: (pr) => store.updateSettings({ pluginUpdatePrChannel: pr }),
      readMoveToStableAfterRelease: () => store.settings.pluginMoveToStableAfterRelease,
    },
    { now, onGitHubAsk: () => void about.refresh(), prChannel: prBuildFollow },
  );
  const updateStager = new UpdateStager(
    network,
    pluginUpdate,
    githubToken,
    undefined,
    (event) => server.emit("system.downloadProgress", event),
    prBuilds,
  );

  const wtfService = new WtfBackupService({
    backupRoot: () => {
      const custom = store.settings.wtfBackupDir;
      return custom ? { path: custom, custom: true } : { path: join(dataDir, "wtf-backups"), custom: false };
    },
    pluginVersion: () => config.pluginVersion,
    deviceId: () => store.deviceId(),
    keepSnapshots: () => store.settings.wtfKeepSnapshots,
    now,
  });
  const wtfJobs = new WtfJobRunner(
    wtfService,
    {
      progress: (payload) => server.emit("wtf.progress", payload),
      completed: (payload) => server.emit("wtf.completed", payload),
      failed: (code, message) => recentErrors.record("wtf", `${code}: ${message}`),
    },
    now,
  );
  function wtfJobTarget(installationId: string): WtfJobTarget {
    const installation = installationService.require(installationId);
    return {
      installationId: installation.id,
      flavor: flavorKeyFor(installation.location, getGameTypeForClientType(installation.clientType)),
      wtfPath: wtfPathFor(installation.location),
    };
  }

  const steam = new InstallationDetector({ homeDir });
  // Checked once: DroidDeck doesn't come or go within an engine's session.
  const playOwner = detectPlayOwner(config.systemRoot ?? "/");
  const linkedGames = new LinkedGameList(
    store,
    () => installationService.list(),
    (games) => server.emit("linkedGames.changed", games),
    () => steam.steamShortcutAppIds(),
    playOwner,
  );
  const launch = new LaunchService(
    // Only a linked game's page launches through WoWDeck (Show in Steam on).
    async (appId, preferredId) => linkedGames.isLinked(appId)
      ? resolveLaunchEntry(
        appId, installationService.listed(), steam, preferredId ?? store.settings.steamLaunchTargets[appId],
      )
      : null,
    config.launchWorld ?? localLaunchWorld(homeDir, () => steam.steamHomes()),
    (completion) => server.emit("launch.completed", completion),
    playOwner,
  );
  const deps: HandlerDeps = {
    launch,
    linkedGames,
    tsmAuth,
    tsmData,
    tsmLedger: new TradeSkillMasterLedgerReader(),
    backendVersion,
    homeDir,
    store,
    registry,
    service,
    catalogue,
    installationService,
    companionCoordinator,
    addonUpdates,
    updateToastGate,
    pluginUpdate,
    updateStager,
    prBuilds,
    curseForgeAuth,
    curseForgeProvider,
    wtfService,
    wtfJobs,
    wtfJobTarget,
    recentErrors,
    about,
  };
  server.handle(handlerTable(deps));

  /**
   * Detect, then recover, before the first request is served. Neither step
   * is fatal. There is no unconditional update refresh here: "plugin loads"
   * is owned by the frontend's own notifications.checkUpdateToast, which
   * is rate-limited to once a day.
   */
  async function start(): Promise<void> {
    void tsmAuth.restore();
    // One health check at startup, not on every screen open; fire and
    // forget so a slow CurseForge never delays the first answer. The
    // bundled key reads "unvalidated" (a real, reportable state) until
    // this resolves.
    void curseForgeAuth.recheck((key) => curseForgeProvider.testApiKey(key));
    // Discovery also refreshes Steam attachments while the QAM is closed. It never opts into updates.
    try {
      await installationService.detect(homeDir);
      // Forget added and removed games deleted from Steam since the last run.
      await linkedGames.forgetDeleted();
    } catch {
      console.error(JSON.stringify({ component: "installation-detection", reason: "startup-scan-failed" }));
    }
    // From here on, a detection or a manual add may bring an installation
    // with no update metadata yet: check every installation, fire-and-forget
    // so the answer isn't held up by every installation's provider calls.
    // The startup scan above starts no check (see this function's comment).
    installationService.foundListeners.add(() => void addonUpdates.checkAll());
    // The frontend reads the linked games once the engine serves; later
    // scans tell it what changed.
    installationService.foundListeners.add(() => linkedGames.scanned());
    // Heal what an interrupted backup or restore left behind (engine
    // killed mid-job, power loss, sleep), in every installation just found.
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
  }

  return {
    server,
    deps,
    call: (method, params) => server.call(method, params),
    serve: (input) => server.run(input),
    start,
  };
}

/** The assembled engine after startup (detect, then recover), ready to serve. */
export async function startEngine(config: EngineConfig): Promise<Engine> {
  const { start, ...engine } = assembleEngine(config);
  await start();
  return engine;
}

/** Start the engine, then serve `input` (stdin by default) until it closes. */
export async function runEngine(config: EngineConfig, input?: AsyncIterable<Uint8Array>): Promise<void> {
  const engine = await startEngine(config);
  await engine.serve(input);
}
