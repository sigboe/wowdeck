import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import {
  ButtonItem,
  DialogButton,
  Field,
  Focusable,
  ConfirmModal,
  PanelSectionRow,
  showModal,
  ToggleField,
} from "@decky/ui";
import { rpc, onBackendEvent } from "../services/backend";
import type {
  TradeSkillMasterDestination,
  TradeSkillMasterAccount,
} from "../../backend/src/api/contracts";
import type { Addon } from "../types";
import { tsmAddonState } from "../tsmAddonState";
import { browseFocusView, holdBrowseSessionForModal } from "../browseSessionState";
import { realmLabel } from "../tsmRealm";
export { realmLabel } from "../tsmRealm";
import { FocusSlot } from "./FocusSlot";
import { requestFocus } from "../focusMemory";
import { openPanel } from "../openPanel";
import { TsmAccount } from "./TsmAccount";
import { formatWhen } from "../wtfFormat";

function UninstallConfirmation({
  installationId,
  onRemove,
  ...props
}: ComponentProps<typeof ConfirmModal> & {
  installationId: string;
  onRemove: (cleanup: boolean, preview?: TradeSkillMasterAccount["follows"]) => void;
}) {
  const [cleanup, setCleanup] = useState(false);
  const [preview, setPreview] = useState<TradeSkillMasterAccount["follows"]>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void rpc("tradeskillmaster.cleanupPreview", { installationId })
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [installationId]);
  return (
    <ConfirmModal {...props} onOK={() => onRemove(cleanup, preview)}>
      <ToggleField
        label="Also unfollow realms added by wowdeck"
        checked={cleanup}
        disabled={!preview?.length}
        onChange={setCleanup}
        description="Cleanup changes your TradeSkillMaster account on all computers."
      />
      {preview?.map((f) => (
        <Field
          key={f.realmId + f.auctionHouseType}
          label={realmLabel(f.name, f.auctionHouseType)}
          description={f.region + " · " + f.gameVersion}
        />
      ))}
      {preview?.length === 0 && <Field label="No eligible follows to remove." />}
      {error && (
        <Field label="Could not preview account cleanup. You can still remove the addons." />
      )}
    </ConfirmModal>
  );
}

/** "Updated 3 minutes ago", in the plugin's fixed formats (C10). */
export function freshness(seconds: number | null, now: number): string {
  return seconds ? `Updated ${formatWhen(seconds * 1000, now)}` : "No auction data yet";
}

/** Focus-memory keys of the side-by-side addon and refresh buttons. */
export const TSM_ADDON_ACTION = "addon-action";
export const TSM_REFRESH = "refresh-data";

/** How long Refresh shows "Refreshing…" when no new data arrives. */
const REFRESH_WAIT_MS = 60_000;

/** The destination uses the same install operation and records as My Addons. */
export function TsmAddon({ installationId }: { installationId: string }) {
  const [data, setData] = useState<TradeSkillMasterDestination>();
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!refreshing) return;
    const timer = setTimeout(() => setRefreshing(false), REFRESH_WAIT_MS);
    return () => clearTimeout(timer);
  }, [refreshing]);
  const currentInstallation = useRef(installationId);
  currentInstallation.current = installationId;
  const requestVersion = useRef(0);
  useEffect(() => {
    let active = true;
    setData(undefined);
    const load = () => {
      const version = ++requestVersion.current;
      void rpc("tradeskillmaster.destination", { installationId })
        .then((result) => {
          if (active && version === requestVersion.current) setData(result);
        })
        .catch(() => {});
    };
    load();
    const off = onBackendEvent((event) => {
      if (event.event !== "tradeskillmaster.changed") return;
      setRefreshing(false);
      setNow(Date.now());
      load();
    });
    return () => {
      active = false;
      off();
    };
  }, [installationId]);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string>();
  const state = tsmAddonState(installationId);
  const { addon, loaded, busy, error } = useSyncExternalStore(state.subscribe, state.get);
  const setAddon = (addon: Addon | undefined) => state.patch({ addon });
  const setLoaded = (loaded: boolean) => state.patch({ loaded });
  const setBusy = (busy: boolean) => state.patch({ busy });
  const setError = (error: string | undefined) => state.patch({ error });
  const loadAddons = async () => {
    const result = await rpc("addons.list", { installationId });
    setAddon(
      result.addons.find((a) =>
        ["TradeSkillMaster", "TradeSkillMaster_AppHelper"].includes(a.folderName),
      ),
    );
    setLoaded(!result.unverified);
  };
  useEffect(() => {
    void loadAddons().catch(() => setError("Could not read installed addons"));
    const off = onBackendEvent((event) => {
      if (event.event === "addons.changed")
        void loadAddons().catch(() => setError("Could not read installed addons"));
    });
    return off;
  }, [installationId]);
  const remove = async (
    cleanupFollows = false,
    cleanupPreview?: TradeSkillMasterAccount["follows"],
  ) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await rpc("tradeskillmaster.removeAddons", {
        installationId,
        ...(cleanupFollows ? { cleanupFollows, cleanupPreview } : {}),
      });
      if (result.operations.some((op) => op.status === "failed" || op.cleanupWarning)) {
        setError(
          "Could not uninstall completely. Check My Addons for removal errors and recovery.",
        );
      }
      if (result.cleanup) {
        const left = result.cleanup.leftBehind.map(
          (f) => realmLabel(f.name, f.auctionHouseType) + " · " + f.region + " · " + f.gameVersion,
        );
        const local = result.operations.some((op) => op.status === "failed" || op.cleanupWarning)
          ? "Addon removal incomplete."
          : "Addons removed.";
        setError(
          local +
            " " +
            (result.cleanup.error ??
              (left.length
                ? "Account cleanup was not completed."
                : "Selected account follows removed.")) +
            (left.length ? " Account follows left behind: " + left.join("; ") : ""),
        );
      }
      await loadAddons();
    } catch {
      setError("Could not uninstall. Check My Addons for removal errors and recovery.");
    } finally {
      setBusy(false);
    }
  };
  const addonAction = (
    <FocusSlot view={browseFocusView("tsm")} id={TSM_ADDON_ACTION}>
      <DialogButton
        style={{ minWidth: 0, width: "100%", padding: "10px 8px" }}
        disabled={busy || !loaded}
        onClick={() => {
          if (addon) {
            const releaseHold = holdBrowseSessionForModal();
            showModal(
              <UninstallConfirmation
                installationId={installationId}
                onRemove={(cleanup, preview) => {
                  void remove(cleanup, preview);
                }}
                strTitle="Uninstall TradeSkillMaster?"
                strDescription="Remove TradeSkillMaster and AppHelper from this installation? Your sign-in stays. Account follows stay unless you select cleanup. Other installations and libraries will stay."
                strOKButtonText="Uninstall both"
                strCancelButtonText="Cancel"
                bDestructiveWarning
                onOK={() => {
                  void remove();
                }}
              />,
              window,
              {
                bHideMainWindowForPopouts: false,
                fnOnClose: () => {
                  requestFocus(browseFocusView("tsm"), TSM_ADDON_ACTION);
                  openPanel("browse");
                  releaseHold();
                },
              },
            );
            return;
          }
          setBusy(true);
          setError(undefined);
          void rpc("addons.install", {
            providerId: "TradeSkillMaster",
            externalId: "TradeSkillMaster",
            installationId,
            channel: "stable",
          })
            .then(async (result) => {
              if (currentInstallation.current !== installationId) return;
              if (result.operation.status === "failed") setError("Installation failed. Try again.");
              await loadAddons();
            })
            .catch(() => setError("Installation failed. Try again."))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Working…" : addon ? "Uninstall" : "Install TradeSkillMaster"}
      </DialogButton>
    </FocusSlot>
  );
  const latest = data
    ? Math.max(0, ...[...data.realms, ...data.regions].map((r) => r.updated ?? 0)) || null
    : null;
  // Every row sits in a PanelSectionRow: it gives Steam's row inset (guide S27).
  const actions = (
    <>
      <PanelSectionRow>
        <Field childrenLayout="below" childrenContainerWidth="max">
          <Focusable
            flow-children="row"
            style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}
          >
            {addonAction}
            {/* In focus memory so Left from here can reach the addon button
                (GetAddonsTab's pane Left handler). */}
            <FocusSlot view={browseFocusView("tsm")} id={TSM_REFRESH}>
              <DialogButton
                style={{ minWidth: 0, width: "100%", padding: "10px 8px" }}
                disabled={followBusy || refreshing}
                onClick={() => {
                  setRefreshing(true);
                  setFollowError(undefined);
                  void rpc("tradeskillmaster.refresh", { installationId }).catch(() => {
                    setRefreshing(false);
                    setFollowError("Could not refresh auction data");
                  });
                }}
              >
                {refreshing ? "Refreshing…" : "Refresh auction data"}
              </DialogButton>
            </FocusSlot>
          </Focusable>
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field
          label={refreshing ? "Asking TradeSkillMaster for new data…" : freshness(latest, now)}
        />
      </PanelSectionRow>
    </>
  );
  const status = data && (
    <>
      <PanelSectionRow>
        {/* Focusable, like the region rows: the D-pad scrolls to all of it (G3). */}
        <Field
          focusable
          label={
            data.realms.length
              ? "Missing a realm or region?"
              : "No saved character evidence in this installation"
          }
          description="To discover a realm or region, create a character there (or use an existing one), log in, then log out to save WoW settings. For Classic, enable TradeSkillMaster and AppHelper before logging in and out. This list uses locally saved settings, not live character information from Blizzard."
        />
      </PanelSectionRow>
      {data.realms.map((realm) => (
        <PanelSectionRow key={realm.id + realm.auctionHouseType}>
          <ButtonItem
            label={realmLabel(realm.name, realm.auctionHouseType)}
            disabled={followBusy || realm.followed}
            description={[
              realm.followed ? freshness(realm.updated, now) : "Not followed",
              realm.followed && !realm.owned
                ? "Unfollowing changes your TradeSkillMaster account everywhere."
                : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            onClick={() => {
              ++requestVersion.current;
              setFollowBusy(true);
              setFollowError(undefined);
              void rpc("tradeskillmaster.setFollow", {
                installationId,
                realmId: realm.id,
                auctionHouseType: realm.auctionHouseType,
                followed: !realm.followed,
              })
                .then((result) => {
                  if (currentInstallation.current === installationId) {
                    ++requestVersion.current;
                    setData(result);
                  }
                })
                .catch(() =>
                  setFollowError(
                    "TradeSkillMaster could not change this follow. Your account may have reached its realm limit.",
                  ),
                )
                .finally(() => setFollowBusy(false));
            }}
          >
            {realm.followed ? "Followed" : "Follow"}
          </ButtonItem>
        </PanelSectionRow>
      ))}
      {followError && (
        <PanelSectionRow>
          <Field label={followError} />
        </PanelSectionRow>
      )}
      {data.regions.map((region) => (
        <PanelSectionRow key={region.id}>
          <Field
            focusable
            label={`${region.name} region data`}
            description={freshness(region.updated, now)}
          />
        </PanelSectionRow>
      ))}
    </>
  );
  // The installed version and channel live in My Addons; this page only
  // installs or uninstalls.
  return (
    <>
      <TsmAccount />
      {actions}
      {status}
      {error && (
        <PanelSectionRow>
          <Field label={error} />
        </PanelSectionRow>
      )}
    </>
  );
}
