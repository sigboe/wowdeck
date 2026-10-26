/**
 * Every plugin setting's rules in one table: its default, how a stored or
 * sent value is made valid, and whether Options may write it
 * (`settings.set`). `StateStore.load()` runs the stored file through the same
 * normalizers, so a bad or outdated value falls back to its default instead
 * of reaching the engine.
 */

import type {
  AutoUpdateResult,
  PluginSettings,
  PluginUpdateBackoff,
  PluginUpdateSnapshot,
} from "../../api/contracts";

interface Rule<T> {
  default: () => T;
  normalize: (value: unknown) => T;
  /** Options may set it through `settings.set`; everything else is engine-written. */
  userWritable: boolean;
}

type Rules = { [K in keyof PluginSettings]: Rule<PluginSettings[K]> };

const toggle = (defaultValue: boolean): Rule<boolean> => ({
  default: () => defaultValue,
  // Only a real true: a string "false" from anywhere must never read as on.
  normalize: (value) => value === true,
  userWritable: true,
});

const stringOrNull = (userWritable: boolean): Rule<string | null> => ({
  default: () => null,
  normalize: (value) => (typeof value === "string" && value !== "" ? value : null),
  userWritable,
});

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : null;
}

/**
 * A Steam library entry as stored (BEYOND-05): a positive integer app id and
 * a display name (trimmed, at most 200 characters); anything else is null.
 */
export function normalizeSteamGame(value: unknown): PluginSettings["steamGame"] {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { appId, name } = value as { appId?: unknown; name?: unknown };
  if (typeof appId !== "number" || !Number.isSafeInteger(appId) || appId <= 0 || typeof name !== "string") {
    return null;
  }
  return { appId, name: name.trim().slice(0, 200) };
}

/**
 * A stored release version (no leading v), or null — the shape every
 * persisted WoWDeck version must have (`pluginUpdateToastShownFor`, the
 * snapshot's `latestVersion`): a bad value only costs one repeated toast, a
 * guessed one could cost a missed one.
 */
function normalizedVersion(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^v?\d+(?:\.\d+){0,2}$/.test(trimmed) ? trimmed.replace(/^v/, "") : null;
}

/**
 * The stored WoWDeck-release answer: a timestamp, a parseable dotted version
 * (no leading v) and two optional URLs. Anything else is dropped rather than
 * half-trusted — a bad stamp only costs one extra check.
 */
export function normalizePluginUpdateSnapshot(value: unknown): PluginUpdateSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { checkedAt, latestVersion, releaseUrl, downloadUrl } = value as Record<string, unknown>;
  if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt)) {
    return null;
  }
  const latest = normalizedVersion(latestVersion);
  if (latest === null) {
    return null;
  }
  const url = (candidate: unknown): string | null =>
    typeof candidate === "string" && candidate !== "" ? candidate : null;
  return {
    checkedAt,
    latestVersion: latest,
    releaseUrl: url(releaseUrl),
    downloadUrl: url(downloadUrl),
  };
}

/**
 * The release check's stored failure backoff: a finite timestamp and at
 * least one consecutive failure. Anything else is dropped — a bad backoff
 * only costs one early retry, while a guessed one could silence the check.
 */
export function normalizePluginUpdateBackoff(value: unknown): PluginUpdateBackoff | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { failedAt, failures } = value as Record<string, unknown>;
  if (typeof failedAt !== "number" || !Number.isFinite(failedAt)) {
    return null;
  }
  if (typeof failures !== "number" || !Number.isSafeInteger(failures) || failures < 1) {
    return null;
  }
  return { failedAt, failures };
}

function normalizeAutoUpdateResult(value: unknown): AutoUpdateResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const { at, updated, failed, skipped } = value as Record<string, unknown>;
  const updatedList = stringList(updated);
  const failedList = stringList(failed);
  if (typeof at !== "number" || !updatedList || !failedList || (skipped !== null && typeof skipped !== "string")) {
    return null;
  }
  return { at, updated: updatedList, failed: failedList, skipped };
}

const RULES: Rules = {
  selectedInstallationId: stringOrNull(false),
  enabledProviders: { default: () => null, normalize: stringList, userWritable: false },
  customWowPaths: { default: () => [], normalize: (value) => stringList(value) ?? [], userWritable: false },
  curseApiKey: stringOrNull(true),
  githubAccessToken: stringOrNull(true),
  // Default on: this replaces the old every-My-Addons-visit toast with
  // one that's already rate-limited to at most once a day, so shipping
  // it off by default would leave users with no update notification at
  // all until they found the setting, for no real benefit (it can never
  // fire more than once a day no matter what).
  updateToastEnabled: toggle(true),
  lastUpdateCheckAt: {
    default: () => null,
    normalize: (value) => (typeof value === "number" && Number.isFinite(value) ? value : null),
    userWritable: false,
  },
  // The once-a-day cap for the plugin's own release check (PluginUpdateCheck):
  // engine-written, never a user preference.
  lastPluginUpdate: {
    default: () => null,
    normalize: normalizePluginUpdateSnapshot,
    userWritable: false,
  },
  // The once-per-release-version toast gate (system.updateCheck's
  // toastPending): engine-written, never a user preference.
  pluginUpdateToastShownFor: {
    default: () => null,
    normalize: normalizedVersion,
    userWritable: false,
  },
  // The failure backoff for the same check (1h/2h/4h capped, cleared by a
  // success): engine-written, never a user preference.
  pluginUpdateBackoff: {
    default: () => null,
    normalize: normalizePluginUpdateBackoff,
    userWritable: false,
  },
  // Only ever stored after validation (settings.set checks the folder).
  wtfBackupDir: stringOrNull(true),
  wtfKeepSnapshots: {
    default: () => 3,
    normalize: (value) => Math.min(10, Math.max(1, Math.round(Number(value)) || 3)),
    userWritable: true,
  },
  steamGame: { default: () => null, normalize: normalizeSteamGame, userWritable: true },
  steamAutoCheck: toggle(true),
  steamBadge: toggle(true),
  hideLibraries: toggle(false),
  hideUnmanaged: toggle(false),
  keepPreviousVersions: toggle(true),
  autoUpdate: toggle(false),
  lastAutoUpdate: { default: () => null, normalize: normalizeAutoUpdateResult, userWritable: false },
  // Hidden: set only in the engine settings file (PC-07).
  newlyUpdatedHours: {
    default: () => 24,
    normalize: (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 24),
    userWritable: false,
  },
};

const KEYS = Object.keys(RULES) as Array<keyof PluginSettings>;

function rule<K extends keyof PluginSettings>(key: K): Rule<PluginSettings[K]> {
  return RULES[key] as Rule<PluginSettings[K]>;
}

export function defaultSettings(): PluginSettings {
  const settings = {} as Record<keyof PluginSettings, unknown>;
  for (const key of KEYS) {
    settings[key] = rule(key).default();
  }
  return settings as PluginSettings;
}

/** A settings object from the state file: every known key made valid, missing ones defaulted, unknown ones dropped. */
export function normalizeStoredSettings(stored: unknown): PluginSettings {
  const source = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const settings = {} as Record<keyof PluginSettings, unknown>;
  for (const key of KEYS) {
    settings[key] = Object.prototype.hasOwnProperty.call(source, key)
      ? rule(key).normalize(source[key])
      : rule(key).default();
  }
  return settings as PluginSettings;
}

/** What `settings.set` may apply from Options: the user-writable keys it sent, each made valid. */
export function userSettingsPatch(sent: unknown): Partial<PluginSettings> {
  const source = sent && typeof sent === "object" ? (sent as Record<string, unknown>) : {};
  const patch = {} as Record<keyof PluginSettings, unknown>;
  for (const key of KEYS) {
    if (rule(key).userWritable && Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
      patch[key] = rule(key).normalize(source[key]);
    }
  }
  return patch as Partial<PluginSettings>;
}

/** Settings for the UI: tokens and keys only say whether they are set. */
export function redactSettings(settings: PluginSettings): PluginSettings {
  return {
    ...settings,
    curseApiKey: settings.curseApiKey ? "<configured>" : null,
    githubAccessToken: settings.githubAccessToken ? "<configured>" : null,
  };
}
