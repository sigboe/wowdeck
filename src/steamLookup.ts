import * as deckyUi from "@decky/ui";

/**
 * Finding Steam's internals on both Steam clients (G13;
 * docs/ui/device-notes.md §8.4f).
 *
 * The webpack Steam client, under Decky 3, exports its components and
 * renderers from webpack modules, and its CSS modules have readable keys
 * (`ViewPlaceholder`, `PlayButtonContainer`). The Vite Steam client (beta,
 * from 2026-11), under Decky 4, keeps many of them in module scope without
 * exporting them, and its CSS module keys are obfuscated (LIVE, Steam Deck
 * 2026-11-22, CLSTAMP 11255874). Decky 4's `@decky/ui` searches module scope
 * (`findVar`, `findModuleScopeByVar`, `findScope`) and maps class names per
 * Steam build into its named tables (`quickAccessMenuClasses`,
 * `appActionButtonClasses`).
 *
 * Each lookup asks the webpack-era way first, so the old client behaves as
 * before, then the Vite-era way where this Decky has it. Remove the first
 * half of each once Decky 3 is gone.
 */

type Filter = (candidate: unknown) => boolean;
type ClassModule = Record<string, unknown>;

/** The @decky/ui searches these lookups use. Decky 3 lacks the module-scope ones. */
export interface DeckyLookupApi {
  findModule?: (filter: Filter) => unknown;
  findModuleExport?: (filter: Filter) => unknown;
  findModuleByExport?: (filter: Filter) => unknown;
  findClassModule?: (filter: (module: ClassModule) => boolean) => unknown;
  /** Decky 4: a module-scope variable matching the filter. */
  findVar?: (filter: Filter) => unknown;
  /** Decky 4: the module scope holding a matching variable. */
  findModuleScopeByVar?: (filter: Filter) => unknown;
  /** Decky 4: a module scope matching the filter. */
  findScope?: (filter: Filter) => unknown;
  /** Decky's named class tables; on Decky 4 mapped per Steam build. */
  quickAccessMenuClasses?: unknown;
  appActionButtonClasses?: unknown;
}

/** The Decky class tables a lookup may fall back to. */
export type ClassTableName = "quickAccessMenuClasses" | "appActionButtonClasses";

function attempt<T>(find: (() => T) | undefined): T | undefined {
  try {
    return find?.() ?? undefined;
  } catch {
    return undefined;
  }
}

/** A class table that names every required key with a real class. */
function complete<K extends string>(
  table: unknown,
  required: readonly K[],
): table is Record<K, string> {
  if (!table || typeof table !== "object") return false;
  const t = table as ClassModule;
  return required.every((key) => typeof t[key] === "string" && t[key] !== "");
}

export function createSteamLookup(ui: DeckyLookupApi) {
  function findExportedModule(filter: Filter): Record<string, unknown> | undefined {
    return attempt(ui.findModule && (() => ui.findModule!(filter))) as
      Record<string, unknown> | undefined;
  }

  return {
    findExportedModule,

    /** A component, renderer or enum Steam exports, or keeps in module scope. */
    findExport(filter: Filter): unknown {
      return (
        attempt(ui.findModuleExport && (() => ui.findModuleExport!(filter))) ??
        attempt(ui.findVar && (() => ui.findVar!(filter)))
      );
    },

    /** The module (or module scope) holding a matching export or variable. */
    findModuleWith(filter: Filter): Record<string, unknown> | undefined {
      return (attempt(ui.findModuleByExport && (() => ui.findModuleByExport!(filter))) ??
        attempt(ui.findModuleScopeByVar && (() => ui.findModuleScopeByVar!(filter)))) as
        Record<string, unknown> | undefined;
    },

    /** A module (or module scope) matching the filter. */
    findModule(filter: Filter): Record<string, unknown> | undefined {
      return (
        findExportedModule(filter) ??
        (attempt(ui.findScope && (() => ui.findScope!(filter))) as
          Record<string, unknown> | undefined)
      );
    },

    /**
     * Steam's CSS module with every `required` key: found by its readable
     * keys, or else Decky's class table `table` (such as
     * `appActionButtonClasses`), when that table names them all. Optional
     * keys come along when the source has them.
     */
    findClasses<K extends string>(
      required: readonly K[],
      table: ClassTableName,
    ): (Record<K, string> & Partial<Record<string, string>>) | undefined {
      const own = attempt(
        ui.findClassModule && (() => ui.findClassModule!((m) => complete(m, required))),
      );
      if (complete(own, required)) return own;
      const named = attempt(() => ui[table]);
      return complete(named, required) ? named : undefined;
    },
  };
}

export type SteamLookup = ReturnType<typeof createSteamLookup>;

/** The lookups against the loaded Decky. */
export const steamLookup: SteamLookup = createSteamLookup(deckyUi as unknown as DeckyLookupApi);
