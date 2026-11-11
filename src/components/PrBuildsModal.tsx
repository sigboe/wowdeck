import { useCallback, useEffect, useRef, useState } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogHeader,
  Field,
  ModalRoot,
  showModal,
} from "@decky/ui";
import { STEAM, descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import { installPrBuild, loadPrBuilds, prBuildConfirmation, prBuildRow } from "../prBuilds";
import { requestPluginUpdate, type StagedUpdate, type UpdateRequestResult } from "../pluginUpdate";
import type { Rpc } from "../services/envelope";
import type { PrBuild } from "../types";

const TITLE = "PR Builds";

/** Waiting for the engine, the list it answered, or "couldn't load". */
type Shown = "loading" | "failed" | PrBuild[];

/** The build the owner picked, while they confirm it or it is being prepared. */
type Confirming = { build: PrBuild; preparing: boolean; error: string | null };

/**
 * The PR builds published right now (GLOSSARY: PR build), opened from the
 * channel picker's "PR builds…" row. It asks the engine when it opens and
 * when Retry is pressed, never on its own: no polling, no toast. Each row
 * is a focusable Field, so the D-pad walks the list; A on a row asks the
 * owner to confirm it, every time. Install stages it in the engine and
 * hands it to Decky's own installer (`requestUpdate`), whose prompt
 * confirms again; Cancel goes back to the list and installs nothing. B
 * closes. Titles and every other field are React text nodes (ADR-0004): a
 * PR's author can't dress up the list.
 *
 * Given `confirm` (the update panel's "Update to X" on a PR build with a
 * newer build listed), it opens on that build's confirmation instead,
 * without loading the list, and Cancel closes it.
 */
export function PrBuildsModal({
  rpc,
  requestUpdate = requestPluginUpdate,
  dateFormat,
  confirm,
  closeModal,
}: {
  rpc: Rpc;
  /** Open on this build's confirmation, not the list. */
  confirm?: PrBuild;
  requestUpdate?: (staged: StagedUpdate) => Promise<UpdateRequestResult>;
  dateFormat?: Intl.DateTimeFormat;
  closeModal?: () => void;
}) {
  const [shown, setShown] = useState<Shown>("loading");
  const [confirming, setConfirming] = useState<Confirming | null>(
    confirm ? { build: confirm, preparing: false, error: null } : null,
  );
  const open = useRef(true);

  const install = (build: PrBuild) => {
    setConfirming({ build, preparing: true, error: null });
    void installPrBuild(rpc, requestUpdate, build).then((error) => {
      if (!open.current) {
        return;
      }
      if (error === null) {
        closeModal?.();
      } else {
        setConfirming({ build, preparing: false, error });
      }
    });
  };

  const load = useCallback(() => {
    setShown("loading");
    void loadPrBuilds(rpc).then((builds) => {
      if (open.current) {
        setShown(builds ?? "failed");
      }
    });
  }, [rpc]);

  useEffect(() => {
    open.current = true;
    if (!confirm) {
      load();
    }
    return () => {
      open.current = false;
    };
  }, [load, confirm]);

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <DialogHeader>{TITLE}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        {confirming && (
          <Confirm
            {...confirming}
            onInstall={install}
            onCancel={() => (confirm ? closeModal?.() : setConfirming(null))}
          />
        )}
        {!confirming && shown === "loading" && (
          <div style={descriptionStyle}>Loading PR builds…</div>
        )}
        {!confirming && shown === "failed" && (
          <>
            <div style={{ ...descriptionStyle, color: STEAM.danger }}>
              Couldn't load PR builds. Check the connection and try again.
            </div>
            <DialogButton onClick={load} style={{ marginTop: "12px" }}>
              Retry
            </DialogButton>
          </>
        )}
        {!confirming && Array.isArray(shown) && shown.length === 0 && (
          <div style={descriptionStyle}>No PR builds right now.</div>
        )}
        {!confirming && Array.isArray(shown) && shown.length > 0 && (
          <DialogControlsSection>
            {shown.map((build) => {
              const row = prBuildRow(build, dateFormat);
              return (
                <Field
                  key={build.number}
                  focusable
                  label={row.label}
                  description={<span style={descriptionStyle}>{row.description}</span>}
                  onClick={() => setConfirming({ build, preparing: false, error: null })}
                />
              );
            })}
          </DialogControlsSection>
        )}
      </DialogBody>
    </ModalRoot>
  );
}

/** The confirmation every PR build install passes: which build, and where its code comes from. */
function Confirm({
  build,
  preparing,
  error,
  onInstall,
  onCancel,
}: Confirming & { onInstall: (build: PrBuild) => void; onCancel: () => void }) {
  const text = prBuildConfirmation(build);
  return (
    <>
      <h3>{text.title}</h3>
      {text.lines.map((line) => (
        <div key={line} style={{ ...descriptionStyle, marginTop: "8px" }}>
          {line}
        </div>
      ))}
      {preparing && (
        <div style={{ ...descriptionStyle, marginTop: "12px" }}>Preparing the PR build…</div>
      )}
      {error && (
        <div style={{ ...descriptionStyle, marginTop: "12px", color: STEAM.danger }}>{error}</div>
      )}
      <DialogButton
        onClick={() => onInstall(build)}
        disabled={preparing}
        style={{ marginTop: "12px" }}
      >
        Install
      </DialogButton>
      <DialogButton onClick={onCancel} disabled={preparing} style={{ marginTop: "8px" }}>
        Cancel
      </DialogButton>
    </>
  );
}

/** Open the PR builds modal over the engine `rpc`; on `confirm`'s confirmation when given. */
export function openPrBuildsModal(rpc: Rpc, confirm?: PrBuild): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <PrBuildsModal rpc={rpc} confirm={confirm} closeModal={close} />,
    window,
    {
      strTitle: TITLE,
      bHideMainWindowForPopouts: false,
    },
  );
}
