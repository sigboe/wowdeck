import { backendErrorMessage } from "../errors";
import { useEffect, useState } from "react";
import {
  ButtonItem,
  DialogBody,
  DialogBodyText,
  DialogButton,
  DialogFooter,
  DialogHeader,
  Field,
  Focusable,
  ModalRoot,
  PanelSectionRow,
  showModal,
} from "@decky/ui";
import type { TradeSkillMasterAccount } from "../../backend/src/api/contracts";
import { engine } from "../engineLink";
import { putTsmAccount, useTsmAccount } from "../tsmReads";
import { browseFocusView, holdBrowseSessionForModal } from "../browseSessionState";
import { FocusRow, FocusSlot } from "./FocusSlot";
import { STEAM } from "../steamTheme";
import { requestFocus } from "../focusMemory";
import { openPanel } from "../openPanel";
import { realmLabel } from "../tsmRealm";

export function allowanceText(
  account: Pick<TradeSkillMasterAccount, "followedCount" | "allowance">,
) {
  return account.allowance === null
    ? `${account.followedCount} realms followed`
    : `${account.followedCount} of ${account.allowance} realms followed`;
}

type Follow = TradeSkillMasterAccount["follows"][number];
/** A follow's row key, stable across reads. */
const followKey = (follow: Follow) => `${follow.realmId}${follow.auctionHouseType}`;

function ManageFollows({
  initial,
  closeModal,
}: {
  initial: TradeSkillMasterAccount;
  closeModal: () => void;
}) {
  const { data, error: refreshError, loading, refresh } = useTsmAccount();
  const account = data ?? initial;
  const [selected, setSelected] = useState<Follow>();
  const [busy, setBusy] = useState(false);
  const [lastRealm, setLastRealm] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (selected) requestFocus("tsm.manage", "cancel");
    else if (lastRealm) requestFocus("tsm.manage", lastRealm);
  }, [selected]);
  const cancel = () => {
    if (!busy) {
      if (selected) setSelected(undefined);
      else closeModal();
    }
  };
  return (
    <ModalRoot onCancel={cancel} closeModal={cancel}>
      <DialogHeader>{selected ? "Unfollow realm?" : "Manage followed realms"}</DialogHeader>
      <DialogBody>
        <Focusable key={selected ? "confirmation" : "follows"}>
          {/* Steam's settings: a count is body text, the follows are rows. */}
          <DialogBodyText>{allowanceText(account)}</DialogBodyText>
          {/* A fixed slot: always laid out, only hidden, so the line coming
              and going never moves the rows below it. */}
          <DialogBodyText style={{ visibility: loading ? "visible" : "hidden" }}>
            Loading followed realms…
          </DialogBodyText>
          {refreshError && (
            <>
              <DialogBodyText style={{ color: STEAM.danger }}>{refreshError}</DialogBodyText>
              <ButtonItem disabled={loading} onClick={() => void refresh()}>
                Retry
              </ButtonItem>
            </>
          )}
          {error && <DialogBodyText style={{ color: STEAM.danger }}>{error}</DialogBodyText>}
          {selected ? (
            <Field
              label={realmLabel(selected.name, selected.auctionHouseType)}
              description="This changes your TradeSkillMaster account on every computer. Later character discovery will not follow this realm again."
            />
          ) : (
            // Each row sits in its own focus-memory slot, which hides it from
            // Steam's row-after-row margin: the column gap puts it back (S10).
            <Focusable
              flow-children="column"
              style={{ display: "flex", flexDirection: "column", gap: "6px" }}
            >
              {account.follows.map((follow) => (
                <FocusSlot key={followKey(follow)} view="tsm.manage" id={followKey(follow)}>
                  <ButtonItem
                    label={realmLabel(follow.name, follow.auctionHouseType)}
                    description={`${follow.region} · ${follow.gameVersion}`}
                    onClick={() => {
                      setError(undefined);
                      setLastRealm(followKey(follow));
                      setSelected(follow);
                    }}
                  >
                    Unfollow
                  </ButtonItem>
                </FocusSlot>
              ))}
              {!account.follows.length && <Field label="No realms followed" />}
            </Focusable>
          )}
        </Focusable>
      </DialogBody>
      <DialogFooter>
        {selected ? (
          // The action first, Cancel second (S12); focus starts on Cancel.
          <Focusable flow-children="row" className="DialogTwoColLayout _DialogColLayout">
            <DialogButton
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(undefined);
                void engine
                  .rpc("tradeskillmaster.unfollow", {
                    realmId: selected.realmId,
                    auctionHouseType: selected.auctionHouseType,
                  })
                  .then((result) => {
                    // The unfollowed row is gone: focus its neighbour, as Steam's lists do.
                    const index = account.follows.findIndex(
                      (f) => followKey(f) === followKey(selected),
                    );
                    const neighbour = account.follows[index + 1] ?? account.follows[index - 1];
                    setLastRealm(neighbour && followKey(neighbour));
                    putTsmAccount(result);
                    setSelected(undefined);
                  })
                  .catch((error) => {
                    backendErrorMessage(error);
                    setError("Couldn't unfollow this realm. Try again.");
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Unfollowing…" : "Unfollow"}
            </DialogButton>
            {/* The slot, not the button, is the footer's flex item: it takes an
                equal column like Unfollow (Steam caps each at half minus 14 px) and
                the button fills it. */}
            <FocusSlot
              view="tsm.manage"
              id="cancel"
              style={{ flex: "1 1 0", minWidth: 0, maxWidth: "calc(50% - 14px)" }}
            >
              <DialogButton
                style={{ width: "100%" }}
                disabled={busy}
                onClick={() => {
                  setSelected(undefined);
                  setError(undefined);
                }}
              >
                Cancel
              </DialogButton>
            </FocusSlot>
          </Focusable>
        ) : (
          <DialogButton onClick={closeModal}>Done</DialogButton>
        )}
      </DialogFooter>
    </ModalRoot>
  );
}

export function TsmAccount() {
  const { data: account, error } = useTsmAccount();
  return (
    <>
      {error && (
        <PanelSectionRow>
          <Field label={error} />
        </PanelSectionRow>
      )}
      {account && (
        <>
          <PanelSectionRow>
            <Field label={account.account ? `Signed in as ${account.account}` : "Signed in"} />
          </PanelSectionRow>
          <FocusRow view={browseFocusView("tsm")} id="manage">
            <ButtonItem
              label={allowanceText(account)}
              onClick={() => {
                const release = holdBrowseSessionForModal();
                const modal = showModal(
                  <ManageFollows initial={account} closeModal={() => modal.Close()} />,
                  window,
                  {
                    bHideMainWindowForPopouts: false,
                    fnOnClose: () => {
                      requestFocus(browseFocusView("tsm"), "manage");
                      openPanel("browse");
                      release();
                    },
                  },
                );
              }}
            >
              Manage
            </ButtonItem>
          </FocusRow>
        </>
      )}
    </>
  );
}
