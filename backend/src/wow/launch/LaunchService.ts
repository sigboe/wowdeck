import { PlayLeftToDroidDeckError, ValidationError } from "../errors";
import type { GameRunning, LaunchClient, LaunchCompletion, LaunchState, MethodMap, PlayOwner } from "../../api/contracts";

export interface LaunchEntry {
  appId: number;
  clients: LaunchClient[];
  target: LaunchClient;
  /**
   * The target's client folders, canonical, with each client's short name:
   * one for Retail or Forever, one per installed version for Classic.
   * Absent for Battle.net.
   */
  targetFolders?: Array<{ path: string; shortName: string }>;
  /** The product code Battle.net is asked to launch; absent for Battle.net. */
  product?: string;
  prefixes: string[];
  libraries: string[];
  /**
   * Each client's icon reader, by client id, for executables this
   * resolution owns. Read on request only: icons stay out of the state.
   */
  icons?: Record<string, () => Promise<string | undefined>>;
}

export interface Observation {
  entryRunning: boolean;
  renderer: number | null;
  gameRunning: GameRunning;
  /** The target folder whose client runs in the entry's prefix, if any. */
  targetRunning: string | null;
  replay?: Replay;
}

export interface Replay {
  reaperPid: number;
  prefix: string;
  argv: string[];
  env: Record<string, string>;
}

export interface LaunchWorld {
  now(): number;
  wait(): Promise<void>;
  observe(entry: LaunchEntry): Promise<Observation>;
  ask(replay: Replay | undefined): Promise<{ startupFailed: Promise<boolean> } | null>;
}

interface LaunchAttempt {
  entry: LaunchEntry;
  steamStart?: { gameId: string; attemptId: string };
  steamRefused: boolean;
}

const WINDOW = 150_000;
const ASK_INTERVAL = 15_000;
const READY_DELAY = 5_000;
const MAX_ASKS = 3;

function validAppId(appId: number): boolean {
  return Number.isInteger(appId) && appId > 0 && appId <= 0xffffffff;
}

export class LaunchService {
  private active: LaunchAttempt | null = null;

  constructor(
    private readonly resolve: (appId: number, preferredId?: string) => Promise<LaunchEntry | null>,
    private readonly world: LaunchWorld,
    private readonly completed: (completion: LaunchCompletion) => void,
    /**
     * Who owns Play on this machine. DroidDeck: no app id has a launch
     * entry, so nothing is read, started or asked.
     */
    private readonly playOwner: PlayOwner,
  ) {}

  private async entry(appId: number): Promise<LaunchEntry | null> {
    return this.playOwner === "wowdeck" && validAppId(appId) ? this.resolve(appId) : null;
  }

  private snapshot(entry: LaunchEntry, observed: Observation): LaunchState {
    return {
      clients: entry.clients,
      target: entry.target,
      entryRunning: observed.entryRunning,
      gameRunning: observed.gameRunning,
      busy: this.active !== null,
    };
  }

  async select(appId: number, targetId: string, save: (target: LaunchClient) => void): Promise<LaunchClient> {
    if (this.playOwner === "droiddeck") throw new PlayLeftToDroidDeckError();
    const entry = validAppId(appId) && typeof targetId === "string"
      ? await this.resolve(appId, targetId)
      : null;
    if (!entry || entry.target.id !== targetId) {
      throw new ValidationError("This client can't be launched from this Steam game page");
    }
    save(entry.target);
    return entry.target;
  }

  async state(appId: number): Promise<LaunchState | null> {
    // A pending attempt keeps its original entry while the page shows the
    // target chosen for the next launch.
    const entry = await this.entry(appId);
    return entry ? this.snapshot(entry, await this.world.observe(entry)) : null;
  }

  async start(
    appId: number,
    canStartSteam = false,
    steamEntryRunning = false,
  ): Promise<MethodMap["launch.start"]["result"]> {
    const entry = await this.entry(appId);
    if (!entry) return { state: null };
    const observed = await this.world.observe(entry);
    const alreadyStarted = observed.entryRunning || steamEntryRunning;
    if (this.active || observed.gameRunning !== "not_running" ||
        (!alreadyStarted && !canStartSteam) ||
        // A running entry already is Battle.net open: nothing to start.
        (alreadyStarted && entry.target.kind === "battlenet")) {
      return { state: this.snapshot(entry, observed) };
    }

    const steamStart = alreadyStarted ? undefined : {
      gameId: ((BigInt(appId) << 32n) | 0x02000000n).toString(),
      attemptId: crypto.randomUUID(),
    };
    const attempt = { entry, steamStart, steamRefused: false };
    this.active = attempt;
    void this.run(attempt, observed);
    return { state: this.snapshot(entry, observed), steamStart };
  }

  /** One client's icon as a data: URL; undefined for WoWDeck's glyph. */
  async icon(appId: number, targetId: string): Promise<string | undefined> {
    const entry = typeof targetId === "string" ? await this.entry(appId) : null;
    const read = entry?.icons && Object.hasOwn(entry.icons, targetId) ? entry.icons[targetId] : undefined;
    return read?.();
  }

  steamRefused(attemptId: string): void {
    if (this.active?.steamStart?.attemptId === attemptId) this.active.steamRefused = true;
  }

  private async run(attempt: LaunchAttempt, initial: Observation): Promise<void> {
    const { entry } = attempt;
    let result: { outcome: LaunchCompletion["outcome"]; started?: string } = { outcome: "ask-failed" };
    try {
      result = await this.attempt(attempt, initial);
    } catch {
      // Process and spawn errors can contain environment, paths and argv.
      console.error(JSON.stringify({ component: "launch", event: "attempt-failed" }));
    } finally {
      this.active = null;
      // Classic names the version that started, e.g. "Classic Era".
      const started = entry.targetFolders?.find(({ path }) => path === result.started);
      this.completed({ appId: entry.appId, clientName: started?.shortName ?? entry.target.shortName, outcome: result.outcome });
    }
  }

  private async attempt(
    attempt: LaunchAttempt, observed: Observation,
  ): Promise<{ outcome: LaunchCompletion["outcome"]; started?: string }> {
    const started = this.world.now();
    let lastAsk = started;
    let renderer = observed.renderer;
    let readySince = started;
    let asks = 0;
    let failedAsks = 0;
    let entrySeen = observed.entryRunning;
    // Battle.net is Steam's own launch: the entry running is the whole job.
    const battleNet = attempt.entry.target.kind === "battlenet";

    for (;;) {
      const now = this.world.now();
      if (observed.targetRunning) return { outcome: "confirmed", started: observed.targetRunning };
      if (battleNet && observed.entryRunning) return { outcome: "confirmed" };
      if (observed.gameRunning === "running") return { outcome: "unconfirmed" };
      entrySeen ||= observed.entryRunning;
      if (!asks && attempt.steamRefused) return { outcome: "steam-refused" };
      const expired = now - started >= WINDOW;
      if (expired || (entrySeen && !observed.entryRunning)) {
        if (!asks) return { outcome: "never-ready" };
        if (failedAsks === asks) return { outcome: "ask-failed" };
        // Battle.net still open with no client after the whole window: the
        // ask reached it and started nothing. Battle.net closing may be its
        // "exit when a game launches" setting, so that stays unconfirmed.
        return { outcome: expired && observed.entryRunning ? "not-started" : "unconfirmed" };
      }

      if (observed.renderer !== renderer) {
        renderer = observed.renderer;
        readySince = now;
      }
      if (!battleNet && observed.entryRunning && renderer !== null && observed.gameRunning === "not_running" && asks < MAX_ASKS &&
          now - readySince >= READY_DELAY && now - lastAsk >= ASK_INTERVAL) {
        const replay = await this.world.ask(observed.replay);
        if (!replay) {
          if (!asks) return { outcome: "ask-failed" };
          failedAsks++;
        } else {
          void replay.startupFailed.then((failed) => {
            if (failed) failedAsks++;
          }, () => {
            // A failed diagnostic read leaves delivery uncertain.
          });
        }
        asks++;
        lastAsk = now;
      }

      await this.world.wait();
      observed = await this.world.observe(attempt.entry);
    }
  }
}
