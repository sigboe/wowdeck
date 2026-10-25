import type { Addon, ReleaseChannel, SearchResult } from "./types";
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
  setBusy(addonId: string, on: boolean): void;
  setUpdatingAll(scope: "installation" | "all" | null): void;
  /** The list changed (or may have): reload it. */
  onChanged(): void;
}

/**
 * The addon actions of My Addons and Get Addons: each runs the row's busy
 * flag, the engine call and the toast, then reloads the list. Confirmations
 * and menus stay in the view.
 */
export function createAddonActions(deps: AddonActionDeps) {
  const { rpc, toast, toastError } = deps;

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    deps.setBusy(id, true);
    try {
      await fn();
    } catch (e) {
      toastError("Something went wrong", e);
    } finally {
      deps.setBusy(id, false);
      deps.onChanged();
    }
  };

  return {
    /**
     * Install a Get Addons result (the one install path, backlog U-13). The
     * result has no addon id yet, so the row keeps its own spinner.
     */
    install: async (result: SearchResult, channel?: ReleaseChannel) => {
      try {
        const { operation } = await rpc("addons.install", {
          providerId: result.providerId,
          externalId: result.externalId,
          channel,
        });
        if (operation.status === "failed") {
          toastError(`Couldn't install ${result.name}`, operation.error ?? "");
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
        deps.onChanged();
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
      }),

    reinstall: (addon: Addon) =>
      withBusy(addon.id, async () => {
        const { operation } = await rpc("addons.reinstall", { addonId: addon.id });
        if (operation.status === "failed") {
          toastError(`Couldn't reinstall ${addon.name}`, operation.error ?? "");
        } else {
          toast(`Reinstalled ${addon.name}`);
        }
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
      }),

    rollback: (addon: Addon) =>
      withBusy(addon.id, async () => {
        // Before the API call: the addon still shows the kept version (S15).
        const undoing = isUndoRollback(addon);
        const { addon: after, operation } = await rpc("addons.rollback", { addonId: addon.id });
        if (operation.status === "failed") {
          toastError(`Couldn't roll back ${addon.name}`, operation.error ?? "");
          return;
        }
        if (undoing) {
          toast(`Returned ${addon.name} to ${after.version ?? "the newer version"}`);
          return;
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
      }),

    setAutoUpdatePaused: (addon: Addon, paused: boolean) =>
      withBusy(addon.id, async () => {
        await rpc("addons.setAutoUpdatePaused", { addonId: addon.id, paused });
        toast(paused ? "Automatic updates paused" : "Automatic updates resumed", addon.name);
      }),

    setIgnored: (addon: Addon, ignored: boolean) =>
      withBusy(addon.id, async () => {
        await rpc("addons.setIgnored", { addonId: addon.id, ignored });
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
          return;
        }
        toast(
          `${after.name} now updates from ${providerLabel(source.providerId)}`,
          adopting && after.previousVersion
            ? `Your files are kept: Roll back returns to ${after.previousVersion}.`
            : "",
        );
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
      }),

    /** This installation, or every one (WF-13: ≡ on the same button, no extra press for the usual case). */
    updateAll: async (scope: "installation" | "all") => {
      deps.setUpdatingAll(scope);
      try {
        const { operations } = await rpc("addons.updateAll", { allInstallations: scope === "all" });
        const failed = operations.filter((o) => o.status === "failed").length;
        const updated = operations.filter((o) => o.status === "updated").length;
        toast(...updateAllToast(updated, failed));
      } catch (e) {
        toastError("Couldn't update addons", e);
      } finally {
        deps.setUpdatingAll(null);
        deps.onChanged();
      }
    },
  };
}

export type AddonActions = ReturnType<typeof createAddonActions>;
