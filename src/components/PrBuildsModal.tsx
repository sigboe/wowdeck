import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogHeader,
  Field,
  ModalRoot,
  ProgressBarWithInfo,
  showModal,
} from "@decky/ui";
import { STEAM, descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import { loadPrBuilds, prBuildConfirmation, prBuildRow } from "../prBuilds";
import { downloadView, type SelfUpdateStore } from "../selfUpdateStore";
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
 * owner to confirm it, every time. Install stages it through the
 * self-update store and hands it to Decky's own installer, whose prompt
 * confirms again; Cancel goes back to the list and installs nothing. B
 * closes. While it downloads, Valve's progress bar takes the buttons'
 * place ("Downloading X of Y MB", then "Preparing…" for Decky's handoff),
 * and B cancels the download silently, back to the confirmation. Titles and every other field are React text nodes (ADR-0004): a
 * PR's author can't dress up the list.
 *
 * Given `confirm` (the update panel's "Update to X" on a PR build with a
 * newer build listed), it opens on that build's confirmation instead,
 * without loading the list, and Cancel closes it.
 */
export function PrBuildsModal({
  rpc,
  selfUpdate,
  dateFormat,
  confirm,
  closeModal,
}: {
  rpc: Rpc;
  /** Stages the build, holds its download progress and cancels it. */
  selfUpdate: Pick<SelfUpdateStore, "get" | "subscribe" | "installPrBuild" | "cancelDownload">;
  /** Open on this build's confirmation, not the list. */
  confirm?: PrBuild;
  dateFormat?: Intl.DateTimeFormat;
  closeModal?: () => void;
}) {
  const download = downloadView(useSyncExternalStore(selfUpdate.subscribe, selfUpdate.get));
  const [shown, setShown] = useState<Shown>("loading");
  const [confirming, setConfirming] = useState<Confirming | null>(
    confirm ? { build: confirm, preparing: false, error: null } : null,
  );
  const open = useRef(true);

  const install = (build: PrBuild) => {
    setConfirming({ build, preparing: true, error: null });
    void selfUpdate.installPrBuild(build).then((ended) => {
      if (!open.current) {
        return;
      }
      if (ended.kind === "installed") {
        closeModal?.();
      } else {
        setConfirming({
          build,
          preparing: false,
          error: ended.kind === "failed" ? ended.error : null,
        });
      }
    });
  };
  const cancelDownload = () => void selfUpdate.cancelDownload();

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
    <ModalRoot
      onCancel={confirming?.preparing ? cancelDownload : closeModal}
      closeModal={closeModal}
    >
      <DialogHeader>{TITLE}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        {confirming && (
          <Confirm
            {...confirming}
            download={confirming.preparing ? download : null}
            onCancelDownload={cancelDownload}
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
  download,
  onInstall,
  onCancel,
  onCancelDownload,
}: Confirming & {
  download: ReturnType<typeof downloadView>;
  onInstall: (build: PrBuild) => void;
  onCancel: () => void;
  onCancelDownload: () => void;
}) {
  const text = prBuildConfirmation(build);
  return (
    <>
      <h3>{text.title}</h3>
      {text.lines.map((line) => (
        <div key={line} style={{ ...descriptionStyle, marginTop: "8px" }}>
          {line}
        </div>
      ))}
      {error && (
        <div style={{ ...descriptionStyle, marginTop: "12px", color: STEAM.danger }}>{error}</div>
      )}
      {preparing ? (
        // The bar takes the buttons' place; B on it cancels the download.
        <Field
          focusable
          preferredFocus
          bottomSeparator="none"
          childrenContainerWidth="max"
          onCancelButton={onCancelDownload}
          onCancelActionDescription="Cancel download"
        >
          <ProgressBarWithInfo
            indeterminate={download?.percent == null}
            nProgress={download?.percent ?? undefined}
            sOperationText={download?.text ?? "Preparing…"}
          />
        </Field>
      ) : (
        <>
          <DialogButton onClick={() => onInstall(build)} style={{ marginTop: "12px" }}>
            Install
          </DialogButton>
          <DialogButton onClick={onCancel} style={{ marginTop: "8px" }}>
            Cancel
          </DialogButton>
        </>
      )}
    </>
  );
}

/**
 * Open the PR builds modal over the engine `rpc`, installing through
 * `selfUpdate`; on `confirm`'s confirmation when given.
 */
export function openPrBuildsModal(rpc: Rpc, selfUpdate: SelfUpdateStore, confirm?: PrBuild): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <PrBuildsModal rpc={rpc} selfUpdate={selfUpdate} confirm={confirm} closeModal={close} />,
    window,
    {
      strTitle: TITLE,
      bHideMainWindowForPopouts: false,
    },
  );
}
