/**
 * OIDC protocol configuration follows tsm-app-linux (MIT), tsm/api/oidc.py.
 * Upstream commit: 1908e34930f742a3a9ce754faf4e1839431fff3a.
 * Reimplemented for Bun RPC, private plugin storage and cancellable listeners.
 * See docs/tsm-provenance.md and THIRD_PARTY_NOTICES.md.
 */
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TradeSkillMasterAuthStatus } from "../../api/contracts";
import type { ProviderRegistry } from "../providers/provider-registry";

/** The registry entry of the TradeSkillMaster source, which sign-in and sign-out turn on and off. */
type Source = Pick<ProviderRegistry, "get" | "setEnabled">;
import { NetworkClient, type NetworkResponse } from "../net/network";

export interface TradeSkillMasterEndpoints {
  authorize: string;
  token: string;
  revoke: string;
  socket?: string;
  realms?: string;
  regions?: string;
  gameVersions?: string;
  userRealms?: string;
}
/**
 * The account as the engine shows it. An email address keeps its first
 * character and its domain; anything else passes through. Bridge payloads
 * end up in logs, so the full address stays in the engine.
 */
export function accountLabel(account: string | null): string | null {
  const at = account?.lastIndexOf("@") ?? -1;
  if (!account || at < 1) return account;
  return `${account[0]}•••${account.slice(at)}`;
}
/** Token and revoke answers are small JSON objects. */
const tokenResponseLimit = 1024 * 1024;
const issuer = "https://id.tradeskillmaster.com/realms/app/protocol/openid-connect";
export const tradeSkillMasterEndpoints: TradeSkillMasterEndpoints = {
  realms: "https://realm-api.tradeskillmaster.com/v2/realms",
  regions: "https://realm-api.tradeskillmaster.com/v2/regions",
  gameVersions: "https://desktop-backend.tradeskillmaster.com/game-versions",
  userRealms: "https://desktop-backend.tradeskillmaster.com/user-realms",
  authorize: `${issuer}/auth`,
  token: `${issuer}/token`,
  revoke: `${issuer}/revoke`,
  socket: "wss://app-backend-sockets.tradeskillmaster.com/socket.io/?EIO=4&transport=websocket",
};
export interface AuthClock {
  random?(): number;
  now?(): number;
  setTimeout(callback: () => void | Promise<void>, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const clock: AuthClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
interface Attempt {
  listener: ReturnType<typeof Bun.serve>;
  timer?: unknown;
  abort: AbortController;
  state: string;
  verifier: string;
  redirect: string;
  exchanging: boolean;
}
export class TradeSkillMasterAuth {
  #attempt?: Attempt;
  readonly sessionListeners = new Set<(token: string | null) => void>();
  private notifySession(): void {
    for (const listener of this.sessionListeners) listener(this.#access);
  }
  get apiEndpoints(): TradeSkillMasterEndpoints { return this.endpoints; }
  get sessionClock(): AuthClock { return this.time; }
  get socketUrl(): string | undefined { return this.endpoints.socket; }
  get userAgent(): string { return `WoWDeck/${this.version}`; }
  #access: string | null = null;
  #refresh: string | null = null;
  #account: string | null = null;
  #signingOut = false;
  #revoked = false;
  #timer?: unknown;
  #tier: "free" | "gold" | "platinum" = "free";
  #channels: string[] = ["release"];
  #generation = 0;
  constructor(
    private dir: string,
    private version: string,
    private registry: Source,
    private endpoints = tradeSkillMasterEndpoints,
    private time: AuthClock = clock,
    private network: NetworkClient = new NetworkClient(),
  ) {}
  /** The one client every TradeSkillMaster request goes through. */
  get net(): NetworkClient { return this.network; }
  status(): TradeSkillMasterAuthStatus {
    return {
      state: this.#attempt
        ? "signingIn"
        : this.#access
          ? "signedIn"
          : this.#revoked
            ? "signedOut"
            : "off",
      account: accountLabel(this.#account),
      ...(this.#access ? { tier: this.#tier, channels: this.#channels } : {}),
    };
  }
  get signedIn(): boolean {
    return !!this.#access;
  }
  async restore(): Promise<void> {
    if (!this.registry.get("TradeSkillMaster")?.enabled) {
      // Off but remembered: show the account; its token stays unused until resume().
      if (this.storedToken()) this.#account = this.storedAccount();
      return;
    }
    try {
      this.#refresh = readFileSync(join(this.dir, "tsm-refresh-token"), "utf8");
    } catch {
      this.#revoked = true;
      return;
    }
    await this.refresh();
  }
  private storedToken(): string | null {
    try {
      return readFileSync(join(this.dir, "tsm-refresh-token"), "utf8");
    } catch {
      return null;
    }
  }
  private storedAccount(): string | null {
    try {
      return readFileSync(join(this.dir, "tsm-account"), "utf8") || null;
    } catch {
      return null;
    }
  }
  private writePrivate(name: string, content: string): void {
    mkdirSync(this.dir, { recursive: true });
    const path = join(this.dir, name);
    const temp = `${path}.${randomBytes(8).toString("hex")}`;
    try {
      writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
      renameSync(temp, path);
    } finally {
      rmSync(temp, { force: true });
    }
  }
  /**
   * The source's off hook: the session stops (no refresh, no socket) but the
   * account is remembered; resume() continues it without a browser sign-in.
   */
  pause(): TradeSkillMasterAuthStatus {
    this.cancel();
    this.#generation++;
    this.time.clearTimeout(this.#timer);
    this.#access = null;
    this.notifySession();
    if (!this.#refresh && !this.storedToken()) this.#account = null;
    return this.status();
  }
  /** The source's on hook with a remembered account; false when there is none. */
  async resume(): Promise<boolean> {
    if (this.#signingOut) return false;
    const token = this.#refresh ?? this.storedToken();
    if (!token) return false;
    this.#refresh = token;
    this.#revoked = false;
    await this.refresh();
    return true;
  }
  private accept(tokens: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }): void {
    const claims = JSON.parse(
      Buffer.from(tokens.access_token.split(".")[1]!, "base64url").toString(),
    );
    if (typeof claims.preferred_username !== "string") throw new Error("Missing account");
    const roles: string[] = claims.realm_access?.roles ?? [];
    this.#tier = roles.includes("premium-platinum")
      ? "platinum"
      : roles.includes("premium-gold")
        ? "gold"
        : "free";
    this.#channels = [
      ...new Set([
        "release",
        ...roles.filter((r) => r.startsWith("channel/")).map((r) => r.slice(8)),
      ]),
    ];
    if (tokens.refresh_token) {
      this.writePrivate("tsm-refresh-token", tokens.refresh_token);
      this.#refresh = tokens.refresh_token;
    }
    if (claims.preferred_username !== this.#account) {
      try {
        this.writePrivate("tsm-account", claims.preferred_username);
      } catch { /* Only the Options label needs it while the source is off. */ }
    }
    this.#access = tokens.access_token;
    this.notifySession();
    this.#account = claims.preferred_username;
    this.#revoked = false;
    this.schedule(Math.max(0, ((tokens.expires_in ?? 300) - 90) * 1000));
  }
  private schedule(ms: number): void {
    this.time.clearTimeout(this.#timer);
    this.#timer = this.time.setTimeout(() => this.refresh(), ms);
  }
  private async refresh(): Promise<void> {
    if (!this.#refresh || this.#revoked) return;
    const generation = this.#generation;
    const abort = new AbortController();
    const timeout = this.time.setTimeout(() => abort.abort(), 15000);
    try {
      const response = await this.post(
        this.endpoints.token,
        { grant_type: "refresh_token", refresh_token: this.#refresh },
        abort.signal,
      );
      const tokens = response.json<{ access_token: string; refresh_token?: string; expires_in?: number; error?: string }>();
      if (generation !== this.#generation) return;
      if (!response.ok) {
        if (tokens.error === "invalid_grant") {
          this.#revoked = true;
          this.#access = this.#account = this.#refresh = null;
          this.notifySession();
          rmSync(join(this.dir, "tsm-refresh-token"), { force: true });
          rmSync(join(this.dir, "tsm-account"), { force: true });
          return;
        }
        throw new Error("Refresh unavailable");
      }
      this.accept(tokens);
    } catch {
      if (generation === this.#generation) this.schedule(30000);
    } finally {
      this.time.clearTimeout(timeout);
    }
  }
  cancel(): TradeSkillMasterAuthStatus {
    const attempt = this.#attempt;
    this.#attempt = undefined;
    if (attempt) {
      this.time.clearTimeout(attempt.timer);
      attempt.abort.abort();
      void attempt.listener.stop(true);
    }
    return this.status();
  }
  begin(): { authorizeUrl: string } {
    if (this.#signingOut) throw new Error("Sign out is still finishing");
    this.cancel();
    this.#generation++;
    this.time.clearTimeout(this.#timer);
    this.#revoked = false;
    this.#access = null;
    this.notifySession();
    void this.registry.setEnabled("TradeSkillMaster", false);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const listener = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => this.callback(req),
    });
    const redirect = `http://localhost:${listener.port}/auth/callback`;
    const attempt: Attempt = {
      listener,
      state,
      verifier,
      redirect,
      abort: new AbortController(),
      exchanging: false,
    };
    this.#attempt = attempt;
    attempt.timer = this.time.setTimeout(() => { this.cancel(); }, 600_000);
    const url = new URL(this.endpoints.authorize);
    url.search = new URLSearchParams({
      client_id: "desktop-app",
      response_type: "code",
      scope: "openid roles profile email tsm-profile offline_access",
      redirect_uri: redirect,
      state,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    }).toString();
    return { authorizeUrl: url.href };
  }
  private async post(
    endpoint: string,
    body: Record<string, string>,
    signal: AbortSignal,
  ): Promise<NetworkResponse> {
    return this.network.send("POST", endpoint, {
      headers: {
        "User-Agent": `WoWDeck/${this.version}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ client_id: "desktop-app", ...body }).toString(),
      signal,
      redirect: "error",
      retries: 0,
      timeoutMs: 15000,
      maxBytes: tokenResponseLimit,
    });
  }
  private async callback(req: Request): Promise<Response> {
    const a = this.#attempt;
    const url = new URL(req.url);
    if (
      !a ||
      url.pathname !== "/auth/callback" ||
      url.searchParams.get("state") !== a.state ||
      a.exchanging
    )
      return new Response("Invalid callback", { status: 400 });
    if (url.searchParams.has("error")) {
      this.cancel();
      return new Response("Sign-in cancelled");
    }
    const code = url.searchParams.get("code");
    if (!code) return new Response("Missing code", { status: 400 });
    a.exchanging = true;
    try {
      const response = await this.post(
        this.endpoints.token,
        {
          grant_type: "authorization_code",
          code,
          code_verifier: a.verifier,
          redirect_uri: a.redirect,
        },
        a.abort.signal,
      );
      if (!response.ok) throw new Error("Token exchange failed");
      const tokens = response.json<{ access_token?: string; refresh_token?: string }>();
      if (!tokens.access_token || !tokens.refresh_token || this.#attempt !== a)
        throw new Error("Sign-in ended");
      this.accept({ ...tokens, access_token: tokens.access_token });
      this.#attempt = undefined;
      this.time.clearTimeout(a.timer);
      void a.listener.stop();
      await this.registry.setEnabled("TradeSkillMaster", true);
      return new Response("Signed in to WoWDeck. You can close this page.");
    } catch {
      if (this.#attempt === a) this.cancel();
      return new Response("Sign-in did not complete. Try again in WoWDeck.", { status: 400 });
    }
  }
  async signOut(): Promise<TradeSkillMasterAuthStatus> {
    this.cancel();
    this.#generation++;
    this.time.clearTimeout(this.#timer);
    this.#revoked = false;
    this.#access = null;
    this.notifySession();
    void this.registry.setEnabled("TradeSkillMaster", false);
    let token = this.#refresh;
    if (!token) {
      try {
        token = readFileSync(join(this.dir, "tsm-refresh-token"), "utf8");
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT")
          throw new Error("Could not read TradeSkillMaster credentials");
      }
    }
    this.#access = this.#refresh = this.#account = null;
    this.#signingOut = true;
    const abort = new AbortController();
    let timer: unknown;
    try {
      rmSync(join(this.dir, "tsm-refresh-token"), { force: true });
      rmSync(join(this.dir, "tsm-account"), { force: true });
      if (token)
        await Promise.race([
          this.post(
            this.endpoints.revoke,
            { token, token_type_hint: "refresh_token" },
            abort.signal,
          ).catch(() => undefined),
          new Promise<void>((resolve) => {
            timer = this.time.setTimeout(() => {
              abort.abort();
              resolve();
            }, 5000);
          }),
        ]);
    } finally {
      this.time.clearTimeout(timer);
      this.#signingOut = false;
    }
    return this.status();
  }
}
export { TradeSkillMasterProvider } from "./TradeSkillMasterProvider";
