import type { Addon, OperationResult, ReleaseChannel, SearchResult } from "./types";
import type { rpcVia } from "./services/envelope";
import { isUndoRollback, providerLabel } from "./addonRow";
import { CHANNEL_LABEL } from "./releaseChannel";
import { updateAllToast } from "./text";

export interface AddonActionDeps {
  rpc: ReturnType<typeof rpcVia>;
  toast(title: string, body?: string): void;
  toastError(title: string, e: unknown): void;
  /** Automatic updates are on (WF-02): a rollback then says the addon is paused. */
  autoUpdateOn(): boolean;
  setUpdatingAll(scope: "installation" | "all" | null): void;
  /** An action starts (on that addon's row: it shows busy); the list may change until it settles. */
  begin(addonId?: string): void;
  /**
   * The action ended, with what it changed in the list. The row stays busy
   * until that change is on screen; a list read it waits for resolves this.
   */
  settled(change: ListChange, addonId?: string): Promise<void> | void;
}

/**
 * What an action changed in the addon list: the addon the engine returned
 * (only that row changed), "reload" when folders came or went (an install,
 * an update, a removal; only a list read sees them), or null for nothing.
 */
export type ListChange = Addon | "reload" | null;

/**
 * The addon actions of My Addons and Get Addons: each runs the engine call
 * and the toast, then says what it changed in the list (the session applies
 * it and runs the row's busy flag). Confirmations and menus stay in the view.
 */
export function createAddonActions(deps: AddonActionDeps) {
  const { rpc, toast, toastError } = deps;

  const withBusy = async (id: string, fn: () => Promise<ListChange>) => {
    deps.begin(id);
    // A rejected call leaves the list unknown: read it again.
    let change: ListChange = "reload";
    try {
      change = await fn();
    } catch (e) {
      toastError("Something went wrong", e);
    } finally {
      await deps.settled(change, id);
    }
  };

  /** A failed operation changes at most the addon's own flags (not on its provider). */
  const afterInstall = (after: Addon, operation: OperationResult): ListChange =>
    operation.status === "failed" ? after : "reload";

  return {
    /**
     * Install a Get Addons result (the one install path, backlog U-13). The
     * result has no addon id yet, so the row keeps its own spinner.
     */
    install: async (result: SearchResult, channel?: ReleaseChannel) => {
      deps.begin();
      let change: ListChange = "reload";
      try {
        const { operation } = await rpc("addons.install", {
          providerId: result.providerId,
          externalId: result.externalId,
          channel,
        });
        if (operation.status === "failed") {
          toastError(`Couldn't install ${result.name}`, operation.error ?? "");
          change = null;
          return;
        }
        toast(`Installed ${result.name}`, channel ? `${CHANNEL_LABEL[channel]} release` : "");
        const missing = operation.missingRequiredDependencies ?? [];
        if (missing.length) {
          // The engine reports provider ids; say names (C05), or nothing.
          const names = await rpc("addons.lookup", {
            providerId: result.providerId,
            externalIds: missing,
          })
            .then(({ addons }) => addons.map((a) => a.name))
            .catch(() => [] as string[]);
          toast(
            `${result.name} may not work`,
            names.length
              ? `It needs ${names.join(", ")}, which couldn't be installed. Install it from Get Addons.`
              : "It needs another addon that couldn't be installed. Install it from Get Addons.",
          );
        }
      } catch (e) {
        toastError(`Couldn't install ${result.name}`, e);
      } finally {
        await deps.settled(change);
      }
    },

    update: (addon: Addon) =>
      withBusy(addon.id, async () => {
        const { addon: after, operation } = await rpc("addons.update", { addonId: addon.id });
        if (operation.status === "failed") {
          toastError(`Couldn't update ${addon.name}`, operation.error ?? "");
        } else if (operation.status === "current") {
          toast(`${addon.name} is up to date`);
        } else {
          toast(`Updated ${addon.name}`, after.version ? `Version ${after.version}` : "");
        }
        return operation.status === "current" ? after : afterInstall(after, operation);
      }),

    reinstall: (addon: Addon) =>
      withBusy(addon.id, async () => {
        const { addon: after, operation } = await rpc("addons.reinstall", { addonId: addon.id });
        if (operation.status === "failed") {
          toastError(`Couldn't reinstall ${addon.name}`, operation.error ?? "");
        } else {
          toast(`Reinstalled ${addon.name}`);
        }
        return afterInstall(after, operation);
      }),

    /**
     * Follow another release channel (WF-03): installs that channel's latest
     * release at once, also when it is older (back to Stable); owner's
     * acceptance condition, 2026-10-16. On failure the old channel stays.
     */
    setChannel: (addon: Addon, channel: ReleaseChannel) =>
      withBusy(addon.id, async () => {
        const { addon: after, operation } = await rpc("addons.setChannel", {
          addonId: addon.id,
          channel,
        });
        const label = CHANNEL_LABEL[channel];
        if (operation.status === "failed") {
          toastError(`Couldn't switch ${addon.name} to ${label}`, operation.error ?? "");
        } else {
          toast(
            `Switched ${addon.name} to ${label}`,
            after.version ? `Version ${after.version} installed` : "",
          );
        }
        return afterInstall(after, operation);
      }),

    rollback: (addon: Addon) =>
      withBusy(addon.id, async () => {
        // Before the API call: the addon still shows the kept version (S15).
        const undoing = isUndoRollback(addon);
        const { addon: after, operation } = await rpc("addons.rollback", { addonId: addon.id });
        if (operation.status === "failed") {
          toastError(`Couldn't roll back ${addon.name}`, operation.error ?? "");
          return after;
        }
        if (undoing) {
          toast(`Returned ${addon.name} to ${after.version ?? "the newer version"}`);
          return "reload";
        }
        const paused =
          deps.autoUpdateOn() && after.autoUpdatePaused
            ? "Automatic updates are paused for it."
            : "";
        const undo = after.previousVersion
          ? `You can return to ${after.previousVersion} from its menu.`
          : "";
        toast(
          `Rolled back ${addon.name} to ${after.version ?? "the previous version"}`,
          [paused, undo].filter(Boolean).join(" "),
        );
        return "reload";
      }),

    setAutoUpdatePaused: (addon: Addon, paused: boolean) =>
      withBusy(addon.id, async () => {
        const { addon: after } = await rpc("addons.setAutoUpdatePaused", {
          addonId: addon.id,
          paused,
        });
        toast(paused ? "Automatic updates paused" : "Automatic updates resumed", addon.name);
        return after;
      }),

    setIgnored: (addon: Addon, ignored: boolean) =>
      withBusy(addon.id, async () => {
        const { addon: after } = await rpc("addons.setIgnored", { addonId: addon.id, ignored });
        return after;
      }),

    /**
     * Install the source picked in Find online source / Change source: an
     * unmanaged folder becomes managed (WF-23; the engine keeps the files it
     * replaces as the previous version), a managed addon moves to that
     * source (WF-12).
     */
    useSource: (addon: Addon, source: SearchResult) =>
      withBusy(addon.id, async () => {
        const target = { providerId: source.providerId, externalId: source.externalId };
        const adopting = !addon.providerId;
        const { addon: after, operation } = adopting
          ? await rpc("addons.adopt", { folderName: addon.folderName, ...target })
          : await rpc("addons.changeSource", { addonId: addon.id, ...target });
        if (operation.status === "failed") {
          toastError(`Couldn't install ${source.name}`, operation.error ?? "");
          // An unmanaged folder has no record to return; nothing changed.
          return adopting ? null : after;
        }
        toast(
          `${after.name} now updates from ${providerLabel(source.providerId)}`,
          adopting && after.previousVersion
            ? `Your files are kept: Roll back returns to ${after.previousVersion}.`
            : "",
        );
        return "reload";
      }),

    /** After the view's confirmation. */
    remove: (addon: Addon) =>
      withBusy(addon.id, async () => {
        if (addon.providerId) {
          await rpc("addons.remove", { addonId: addon.id });
        } else {
          await rpc("addons.removeUnmanaged", { folderName: addon.folderName });
        }
        toast(`Removed ${addon.name}`);
        // Libraries nothing needs any more go with it, and other rows' Needed by changes.
        return "reload";
      }),

    /** This installation, or every one (WF-13: ≡ on the same button, no extra press for the usual case). */
    updateAll: async (scope: "installation" | "all") => {
      deps.begin();
      deps.setUpdatingAll(scope);
      try {
        const { operations } = await rpc("addons.updateAll", { allInstallations: scope === "all" });
        const failed = operations.filter((o) => o.status === "failed").length;
        const updated = operations.filter((o) => o.status === "updated").length;
        toast(...updateAllToast(updated, failed));
      } catch (e) {
        toastError("Couldn't update addons", e);
      } finally {
        // The bar stays until the updated list is on screen.
        await deps.settled("reload");
        deps.setUpdatingAll(null);
      }
    },
  };
}

export type AddonActions = ReturnType<typeof createAddonActions>;
