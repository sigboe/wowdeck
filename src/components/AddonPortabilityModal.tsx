import { ScrollBuffer } from "./ScrollBuffer";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DialogBody,
  DialogBodyText,
  DialogButton,
  DialogButtonPrimary,
  DialogControlsSection,
  DialogControlsSectionHeader,
  DialogFooter,
  DialogHeader,
  DropdownItem,
  Field,
  Focusable,
  ModalRoot,
  Spinner,
  TextField,
  showModal,
} from "@decky/ui";
import { FileSelectionType, openFilePicker } from "@decky/api";
import type { Installation, ImportComparison, ImportSummary, OperationResult } from "../types";
import * as api from "../services/backend";
import { copyText } from "../services/clipboard";
import { errorText } from "../errors";
import { STEAM, descriptionStyle } from "../steamTheme";
import { pluginToast, toastError } from "../toast";
import { plural } from "../text";
import { installationLabel } from "../search";
import { wowupModalStyleCss } from "../sharedStyles";
import { ellipsisValue } from "./dropdownValue";
import { TextRow } from "./TextRow";

type Mode = "export" | "import";

/**
 * TextField is `@decky/ui`'s thin re-export of SteamUI's own internal
 * component (found via webpack module search, not authored by
 * decky/ui itself — see its compiled TextField.js), so its .d.ts is
 * only a best-effort guess at what the real component accepts.
 * `placeholder` is missing from that guess even though TextField wraps
 * a real `<input>`, which is why it's forwarded through this cast
 * rather than passed directly — needs on-device confirmation that it
 * actually renders as ghost text rather than being silently dropped.
 */
const TextFieldWithPlaceholder = TextField as React.FC<
  React.ComponentProps<typeof TextField> & { placeholder?: string }
>;

interface ModalProps {
  mode: Mode;
  installations: Installation[];
  selectedInstallationId: string | null;
  onInstalled: () => void;
  closeModal?: () => void;
}

const STATE_LABELS: Record<ImportComparison["state"], string> = {
  new: "New",
  no_change: "Already installed",
  conflict: "Skipped",
  unresolved: "Can't install",
};

const STATE_COLORS: Record<ImportComparison["state"], string> = {
  new: STEAM.positive,
  no_change: STEAM.textMuted,
  conflict: STEAM.warning,
  unresolved: STEAM.danger,
};

/** `wowdeck-addons-<game>-<date>.txt`, e.g. `wowdeck-addons-classic-era-2026-10-13.txt`. */
function defaultExportFilename(installation: Installation | undefined): string {
  const label = installationLabel(installation) ?? "addons";
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "addons";
  const date = new Date().toISOString().slice(0, 10);
  return `wowdeck-addons-${slug}-${date}.txt`;
}

/**
 * Addon List Import/Export — Options' two entry points share this one
 * modal, switching only the default action shown first (`mode`). A
 * dedicated subview rather than WowUp's My Addons toolbar dialog: this
 * project keeps the feature in Options (Stage 4 of the sprint that
 * added this), and a self-contained modal is the right shape for it —
 * nothing here needs to survive the panel teardown every modal causes
 * (see openAddonDetailsModal's own comment on that), since closing this
 * modal is always the deliberate end of the workflow.
 */
function AddonPortabilityModal({
  mode,
  installations,
  selectedInstallationId,
  onInstalled,
  closeModal,
}: ModalProps) {
  const [installationId, setInstallationId] = useState(
    selectedInstallationId ?? installations[0]?.id ?? "",
  );

  const [exporting, setExporting] = useState(false);
  const [exportPayload, setExportPayload] = useState<string | null>(null);
  const [exportMeta, setExportMeta] = useState<{
    collectionName: string;
    exportedCount: number;
    ignoredCount: number;
    unsupported: { name: string; reason: string }[];
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [importText, setImportText] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<OperationResult[] | null>(null);
  // Newest preview wins (guide A1): paste-debounce and file-load can overlap.
  const previewRequestRef = useRef(0);
  const previewDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const installation = installations.find((i) => i.id === installationId);

  useEffect(() => {
    return () => {
      if (previewDebounce.current) {
        clearTimeout(previewDebounce.current);
      }
    };
  }, []);

  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    setExportPayload(null);
    setExportMeta(null);
    try {
      const result = await api.rpc("addons.export", {
        installationId: installationId || undefined,
      });
      setExportPayload(result.payload);
      setExportMeta({
        collectionName: result.collectionName,
        exportedCount: result.exportedCount,
        ignoredCount: result.ignoredCount,
        unsupported: result.unsupported,
      });
    } catch (e) {
      setExportError(errorText(e));
    } finally {
      setExporting(false);
    }
  };

  const copyExport = async () => {
    if (!exportPayload) {
      return;
    }
    try {
      const { ok, message } = await copyText(exportPayload);
      pluginToast(
        ok ? "Export code copied" : "Couldn't copy. Select the text above instead.",
        ok ? "" : message,
      );
    } catch (e) {
      toastError("Couldn't copy", e);
    }
  };

  const saveExportToFile = async () => {
    if (!exportPayload) {
      return;
    }
    let folder: { path: string };
    try {
      folder = await openFilePicker(
        FileSelectionType.FOLDER,
        installation?.path ?? "",
        false,
        true,
      );
    } catch {
      // user cancelled the picker — nothing to report
      return;
    }
    setSaving(true);
    try {
      const { ok, path, message } = await api.saveTextFile(
        folder.path,
        defaultExportFilename(installation),
        exportPayload,
      );
      pluginToast(
        ok ? "Export code saved" : "Couldn't save the export code",
        ok ? (path ?? "") : message,
      );
    } catch (e) {
      toastError("Couldn't save the export code", e);
    } finally {
      setSaving(false);
    }
  };

  const loadFromFile = async () => {
    let picked: { path: string };
    try {
      picked = await openFilePicker(
        FileSelectionType.FILE,
        installation?.path ?? "",
        true,
        false,
        undefined,
        ["txt"],
        false,
        true,
      );
    } catch {
      // user cancelled the picker — nothing to report
      return;
    }
    setLoadingFile(true);
    try {
      const { ok, content, message } = await api.readTextFile(picked.path);
      if (ok && content != null) {
        setImportText(content);
        // Preview immediately rather than waiting for a separate click —
        // loading a file is already a declaration of intent to import
        // it, and otherwise the counts/Apply row stay blank (and Apply
        // disabled, with no explanation yet) until the user remembers
        // the extra step. runPreviewFor takes the text directly instead
        // of reading `importText` state, which setImportText above
        // hasn't actually applied yet within this same function.
        await runPreviewFor(content);
      } else {
        pluginToast("Couldn't read file", message || "");
      }
    } catch (e) {
      toastError("Couldn't read file", e);
    } finally {
      setLoadingFile(false);
    }
  };

  const runPreviewFor = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const requestId = ++previewRequestRef.current;
    setPreviewing(true);
    setPreviewError(null);
    setSummary(null);
    setApplyResults(null);
    try {
      const { summary: result, error } = await api.rpc("addons.previewImport", {
        importString: trimmed,
        installationId: installationId || undefined,
      });
      if (requestId !== previewRequestRef.current) {
        return;
      }
      if (error) {
        setPreviewError(error.message);
      } else {
        setSummary(result);
      }
    } catch (e) {
      if (requestId === previewRequestRef.current) {
        setPreviewError(errorText(e));
      }
    } finally {
      if (requestId === previewRequestRef.current) {
        setPreviewing(false);
      }
    }
  };

  const runPreview = () => runPreviewFor(importText);

  /**
   * There's no separate Preview button anymore — pasting/editing the
   * import string previews it automatically, same as loadFromFile
   * already does after picking a file. Debounced rather than firing on
   * every keystroke: pasting a long base64 string can still arrive as
   * several onChange events depending on how the text got in (gamepad
   * on-screen keyboard vs. an actual paste), and nobody needs a preview
   * request mid-paste.
   */
  const onImportTextChange = (value: string) => {
    setImportText(value);
    setSummary(null);
    setApplyResults(null);
    setPreviewError(null);
    if (previewDebounce.current) {
      clearTimeout(previewDebounce.current);
    }
    previewDebounce.current = setTimeout(() => {
      void runPreviewFor(value);
    }, 500);
  };

  const runImport = async () => {
    const trimmed = importText.trim();
    if (!trimmed) {
      return;
    }
    setApplying(true);
    try {
      const { operations, error } = await api.rpc("addons.importAddonList", {
        importString: trimmed,
        installationId: installationId || undefined,
      });
      if (error) {
        pluginToast("Couldn't import", error.message);
        return;
      }
      setApplyResults(operations);
      const installed = operations.filter((op) => op.status !== "failed").length;
      const failed = operations.filter((op) => op.status === "failed").length;
      pluginToast(
        installed > 0 ? `Installed ${plural(installed, "addon")}` : "Nothing new to install",
        failed > 0 ? `${plural(failed, "addon")} couldn't be installed. See the list.` : "",
      );
      if (installed > 0) {
        onInstalled();
      }
      // Re-preview so the list reflects what's now actually installed
      // (new -> no_change) instead of a stale "new" row for an addon
      // that was just installed.
      await runPreview();
    } catch (e) {
      toastError("Couldn't import", e);
    } finally {
      setApplying(false);
    }
  };

  const chooseInstallation = (id: string) => {
    setInstallationId(id);
    setExportPayload(null);
    setExportMeta(null);
    setSummary(null);
    setApplyResults(null);
  };

  const installationPicker = installations.length > 1 && (
    <DropdownItem
      label="Installation"
      rgOptions={installations.map((i) => ({ data: i.id, label: i.displayName }))}
      selectedOption={installationId}
      onChange={(option) => chooseInstallation(option.data as string)}
      renderButtonValue={ellipsisValue("240px")}
    />
  );

  const applyDisabled = applying || !summary || summary.addedCt === 0;
  const summaryParts = summary
    ? [
        summary.addedCt > 0 ? `${summary.addedCt} new` : "",
        summary.noChangeCt > 0 ? `${summary.noChangeCt} already installed` : "",
        summary.conflictCt > 0 ? `${summary.conflictCt} skipped` : "",
        summary.unresolvedCt > 0 ? `${summary.unresolvedCt} can't be installed` : "",
      ].filter((part) => part !== "")
    : [];
  const muted = (text: ReactNode, color: string = STEAM.textMuted) => (
    <DialogBodyText style={{ ...descriptionStyle, color }}>{text}</DialogBodyText>
  );

  // Steam's dialog components, no plugin CSS (guide S8, S12).
  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal} bAllowFullSize>
      <DialogHeader>{mode === "export" ? "Export addon list" : "Import addon list"}</DialogHeader>
      <DialogBody>
        <style>{wowupModalStyleCss()}</style>
        <ScrollBuffer>
          <DialogBodyText>
            Moves the addon list for {installation?.displayName ?? "the selected installation"}, not
            addon settings or WoW&apos;s saved variables. Works with lists exported by WowUp, and
            the other way round.
          </DialogBodyText>

          {mode === "export" ? (
            <>
              <DialogControlsSection>
                {installationPicker}
                <Field
                  focusable={!exporting && !!installationId}
                  disabled={exporting || !installationId}
                  label="Create export code"
                  description={<span style={descriptionStyle}>Copy it or save it to a file</span>}
                  onClick={() => !exporting && !!installationId && void runExport()}
                >
                  {exporting ? <Spinner style={{ width: "1.2em" }} /> : null}
                </Field>
              </DialogControlsSection>
              {exportError && muted(exportError, STEAM.danger)}
              {exportPayload && exportMeta && (
                <DialogControlsSection>
                  <TextRow label="Export code" layout="inline">
                    <TextField value={exportPayload} onChange={() => {}} />
                  </TextRow>
                  <Field
                    focusable
                    label="Copy export code"
                    description={
                      <span style={descriptionStyle}>To paste into WowUp or another Deck</span>
                    }
                    onClick={() => void copyExport()}
                  />
                  <Field
                    focusable={!saving}
                    label="Save to file"
                    description={
                      <span style={descriptionStyle}>{defaultExportFilename(installation)}</span>
                    }
                    onClick={() => !saving && void saveExportToFile()}
                  >
                    {saving ? <Spinner style={{ width: "1.2em" }} /> : null}
                  </Field>
                  {muted(
                    `${exportMeta.exportedCount} addon(s) exported${
                      exportMeta.ignoredCount > 0
                        ? `, ${exportMeta.ignoredCount} ignored addon(s) skipped`
                        : ""
                    }.`,
                  )}
                  {exportMeta.unsupported.length > 0 &&
                    muted(
                      `Couldn't export: ${exportMeta.unsupported.map((u) => u.name).join(", ")}.`,
                      STEAM.warning,
                    )}
                </DialogControlsSection>
              )}
            </>
          ) : (
            <>
              <DialogControlsSection>
                {installationPicker}
                <TextRow label="Export code" layout="inline">
                  <TextFieldWithPlaceholder
                    placeholder="Paste it here, or load a file below"
                    value={importText}
                    onChange={(e) => onImportTextChange(e.target.value)}
                  />
                </TextRow>
                <Field
                  focusable={!loadingFile}
                  label="Load from file"
                  description={
                    <span style={descriptionStyle}>
                      A .txt export from WowUp or WoWDeck Addon Manager
                    </span>
                  }
                  onClick={() => !loadingFile && void loadFromFile()}
                >
                  {loadingFile ? <Spinner style={{ width: "1.2em" }} /> : null}
                </Field>
              </DialogControlsSection>

              {previewError && muted(previewError, STEAM.danger)}
              {!summary &&
                !previewError &&
                muted(
                  previewing
                    ? "Checking the list…"
                    : "The list is checked as soon as you paste or load it",
                )}

              {summary && (
                <DialogControlsSection>
                  <DialogControlsSectionHeader>
                    {summaryParts.join(" · ")}
                  </DialogControlsSectionHeader>
                  {summary.comparisons.map((c, i) => (
                    // Field focusable: a read-only row that the D-pad can still reach and scroll to.
                    <Field
                      key={`${c.providerId}:${c.externalId}:${i}`}
                      focusable
                      label={c.name}
                      description={
                        <span style={descriptionStyle}>
                          <span style={{ color: STATE_COLORS[c.state] }}>
                            {STATE_LABELS[c.state]}
                          </span>
                          {c.reason ? ` · ${c.reason}` : ""}
                        </span>
                      }
                    />
                  ))}
                </DialogControlsSection>
              )}

              {applyResults && (
                <DialogControlsSection>
                  {applyResults.map((op, i) => (
                    <DialogBodyText
                      key={op.operationId ?? i}
                      style={{
                        ...descriptionStyle,
                        color: op.status === "failed" ? STEAM.danger : STEAM.positive,
                      }}
                    >
                      {op.addonName ? `${op.addonName}: ` : ""}
                      {op.status === "failed"
                        ? `failed, ${op.error ?? "unknown error"}`
                        : "installed"}
                    </DialogBodyText>
                  ))}
                </DialogControlsSection>
              )}
            </>
          )}
        </ScrollBuffer>
      </DialogBody>
      {mode === "import" && (
        <DialogFooter>
          <Focusable flow-children="row" className="DialogTwoColLayout _DialogColLayout">
            <DialogButtonPrimary disabled={applyDisabled} onClick={runImport}>
              {applying ? (
                <Spinner style={{ width: "1em" }} />
              ) : (
                `Install${summary && summary.addedCt > 0 ? ` ${summary.addedCt} new` : ""}`
              )}
            </DialogButtonPrimary>
            <DialogButton onClick={closeModal}>Close</DialogButton>
          </Focusable>
        </DialogFooter>
      )}
    </ModalRoot>
  );
}

export interface OpenAddonPortabilityModalProps {
  mode: Mode;
  installations: Installation[];
  selectedInstallationId: string | null;
  onInstalled: () => void;
}

export function openAddonPortabilityModal({
  mode,
  installations,
  selectedInstallationId,
  onInstalled,
}: OpenAddonPortabilityModalProps): void {
  const close = () => modalResult.Close();
  const element = (
    <AddonPortabilityModal
      mode={mode}
      installations={installations}
      selectedInstallationId={selectedInstallationId}
      onInstalled={onInstalled}
      closeModal={close}
    />
  );
  const modalResult = showModal(element, window, {
    strTitle: mode === "export" ? "Export addon list" : "Import addon list",
    bHideMainWindowForPopouts: false,
  });
}
