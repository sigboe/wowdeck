import { useEffect, useState } from "react";
import {
  DialogBody,
  DialogButton,
  DialogButtonPrimary,
  DialogControlsSection,
  DialogControlsSectionHeader,
  DialogFooter,
  DialogHeader,
  Field,
  Focusable,
  ModalRoot,
  showModal,
} from "@decky/ui";
import type {
  Installation,
  InstallationRecoveryDetails,
  RecoveryRetryResult,
  RecoveryVerifyResult,
} from "../types";
import * as api from "../services/backend";
import { addonSession } from "../session";
import { STEAM, descriptionStyle } from "../steamTheme";
import { wowupModalStyleCss } from "../sharedStyles";
import {
  recoveryOperationView,
  recoveryOutcomeView,
  unavailableActionsView,
  type RecoveryRow,
} from "../recovery";
import { ScrollBuffer } from "./ScrollBuffer";

/**
 * The shared recovery-details view (ADR 0006, #107): opened from the
 * recovery notice in any tab. The engine answers what is kept where and
 * what stands in the way (`installations.recoveryDetails`); this view only
 * shows it. Read-only rows are focusable so the D-pad scrolls to each one.
 * Its footer offers Retry recovery (#108) and Verify recovery (#109) when
 * the engine says they apply; the engine checks everything again, and its
 * answer shows at the top.
 */
function RecoveryDetailsModal({
  installation,
  closeModal,
}: {
  installation: Installation;
  closeModal?: () => void;
}) {
  const close = () => closeModal?.();
  const [details, setDetails] = useState<InstallationRecoveryDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RecoveryRetryResult | RecoveryVerifyResult | null>(null);
  const [running, setRunning] = useState<"retry" | "verify" | null>(null);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let live = true;
    api
      .rpc("installations.recoveryDetails", { installationId: installation.id })
      .then((d) => live && (setDetails(d), setError(null)))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [installation.id, reads]);
  const run = async (action: "retry" | "verify") => {
    setRunning(action);
    try {
      const result = await (action === "retry"
        ? addonSession.retryRecovery(installation.id)
        : addonSession.verifyRecovery(installation.id));
      if (result) {
        setOutcome(result);
        setReads((n) => n + 1); // what is kept where changed, or the block is gone
      }
    } finally {
      setRunning(null);
    }
  };
  return (
    <ModalRoot onCancel={close} closeModal={close} bAllowFullSize>
      <DialogHeader>Recovery details</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <RecoveryDetailsContent
            installationName={installation.displayName}
            details={details}
            error={error}
            now={Date.now()}
            outcome={outcome}
          />
        </ScrollBuffer>
      </DialogBody>
      <DialogFooter>
        <RecoveryDetailsFooter
          details={details}
          running={running}
          onRetry={() => void run("retry")}
          onVerify={() => void run("verify")}
          onClose={close}
        />
      </DialogFooter>
    </ModalRoot>
  );
}

/**
 * The footer's buttons: Retry recovery and Verify recovery, each only while
 * the installation needs recovery and the engine offers it, both off while
 * either runs; Close always.
 */
export function RecoveryDetailsFooter({
  details,
  running,
  onRetry,
  onVerify,
  onClose,
}: {
  details: InstallationRecoveryDetails | null;
  running: "retry" | "verify" | null;
  onRetry: () => void;
  onVerify: () => void;
  onClose: () => void;
}) {
  const needed = details?.status === "recoveryRequired";
  return (
    <Focusable flow-children="row" className="DialogTwoColLayout _DialogColLayout">
      {needed && details.retry.available && (
        <DialogButtonPrimary onClick={onRetry} disabled={running !== null}>
          {running === "retry" ? "Retrying recovery…" : "Retry recovery"}
        </DialogButtonPrimary>
      )}
      {needed && details.verify.available && (
        <DialogButton onClick={onVerify} disabled={running !== null}>
          {running === "verify" ? "Verifying recovery…" : "Verify recovery"}
        </DialogButton>
      )}
      <DialogButton onClick={onClose}>Close</DialogButton>
    </Focusable>
  );
}

function RowField({ row }: { row: RecoveryRow }) {
  return (
    <Field
      focusable
      childrenLayout="below"
      label={
        row.kind === "conflict" ? (
          <span style={{ color: STEAM.warning }}>{row.label}</span>
        ) : (
          row.label
        )
      }
      description={<span style={descriptionStyle}>{row.description}</span>}
    />
  );
}

/** The view's body for the engine's answer (null while it loads). */
export function RecoveryDetailsContent({
  installationName,
  details,
  error,
  now,
  outcome = null,
}: {
  installationName: string;
  details: InstallationRecoveryDetails | null;
  error: string | null;
  now: number;
  /** Retry recovery's or Verify recovery's last answer in this view, if any. */
  outcome?: RecoveryRetryResult | RecoveryVerifyResult | null;
}) {
  const result = outcome && recoveryOutcomeView(outcome);
  const outcomeSection = result && (
    <DialogControlsSection>
      <Field
        focusable
        label={result.label}
        description={<span style={descriptionStyle}>{result.description}</span>}
      />
      {result.rows.map((row) => (
        <RowField key={`${row.kind}:${row.label}`} row={row} />
      ))}
    </DialogControlsSection>
  );
  if (error) {
    return (
      <DialogControlsSection>
        <Field focusable label="Couldn't read the recovery details">
          <span style={descriptionStyle}>{error}</span>
        </Field>
      </DialogControlsSection>
    );
  }
  if (!details) {
    return (
      <DialogControlsSection>
        <Field focusable label="Reading the recovery details…" />
      </DialogControlsSection>
    );
  }
  if (details.status === "ready") {
    return (
      <>
        {outcomeSection}
        <DialogControlsSection>
          <Field focusable label={`${installationName} doesn't need recovery`} />
        </DialogControlsSection>
      </>
    );
  }
  return (
    <>
      {outcomeSection}
      {unavailableActionsView(details).map((line) => (
        <DialogControlsSection key={line.label}>
          <Field
            focusable
            label={line.label}
            description={<span style={descriptionStyle}>{line.description}</span>}
          />
        </DialogControlsSection>
      ))}
      <DialogControlsSection>
        <Field
          focusable
          label={installationName}
          description={
            <span style={descriptionStyle}>
              An addon change stopped before it could put the addon&apos;s files back. WoWDeck Addon
              Manager preserved recovery copies and paused addon changes in this installation. Its
              addon information is unverified. Other installations work normally.
            </span>
          }
        />
      </DialogControlsSection>
      {details.operations.map((op) => {
        const view = recoveryOperationView(op, now);
        return (
          <DialogControlsSection key={op.transactionId}>
            <DialogControlsSectionHeader>{view.title}</DialogControlsSectionHeader>
            <Field focusable label={view.summary} />
            {view.rows.map((row) => (
              <RowField key={`${row.kind}:${row.label}`} row={row} />
            ))}
          </DialogControlsSection>
        );
      })}
    </>
  );
}

export function openRecoveryDetails(installation: Installation): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <RecoveryDetailsModal installation={installation} closeModal={close} />,
    window,
    { strTitle: "Recovery details", bHideMainWindowForPopouts: false },
  );
}
