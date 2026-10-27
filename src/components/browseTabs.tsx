import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FileSelectionType, openFilePicker } from "@decky/api";
import { DialogButton, Field, Focusable, PanelSectionRow, Spinner, TextField } from "@decky/ui";
import type {
  ArchivePreview,
  Installation,
  ProviderInfo,
  ReleaseChannel,
  SearchResult,
} from "../types";
import * as api from "../services/backend";
import { installationLabel, searchHelperText } from "../search";
import { browseFocusView, popupOpening } from "../browseSessionState";
import { sourceOffNotice, zeroCapabilityScreen } from "../sourceAccess";
import {
  type ListDestinationId,
  listDestination,
  loadMore,
  resolveUrl,
  runSearch,
  searchDestination,
  setUrl,
  urlDestination,
} from "../browseDestinations";
import { fileImport, installArchive, pickArchive } from "../fileImportState";
import { hasMore } from "../loadMore";
import { addonSession } from "../session";
import { installedAddonFor, resultInstallLabel, resultTags } from "../addonSession";
import { STEAM, descriptionStyle } from "../steamTheme";
import { AddonResultRow } from "./AddonResultRow";
import { ZeroCapabilityScreen } from "./ZeroCapabilityScreen";
import { FocusSlot, focusTarget } from "./FocusSlot";
import { revealRemembered } from "../focusMemory";
import { openAddonDetailsModal, resultDetails } from "./AddonDetailsModal";
import { showChoiceMenu } from "./choiceMenu";
import { installChannelChoices } from "../releaseChannel";

/**
 * The four browse destinations (Search, Latest, Popular, Manual Install) and
 * their result rows: the one browse code path, rendered in the QAM's Get
 * Addons pane (UI-02 rev 2). Everything here is chrome-agnostic; the QAM tab
 * owns the destination list and the pane around it.
 */

/** The result's key among the rows. */
const resultKey = (r: SearchResult) => `${r.providerId}:${r.externalId}`;

/**
 * What Get Addons needs to act on its sources (GetAddonsTab owns them): the
 * list, and the one way out of a source problem — the jump to Options, the
 * only place a source is turned on (the zero-capability screen's button and
 * Manual Install's off-source notice under a link result).
 */
export interface SourceControls {
  providers: ProviderInfo[];
  /** The sources have loaded (or failed to): the capability decision is final. */
  loaded: boolean;
  /** Open Options' sources section, marking these provider ids. */
  openSources: (marked: readonly string[]) => void;
}

export function Status({ text, tone }: { text: string; tone?: "error" | "warning" | "positive" }) {
  const color =
    tone === "error"
      ? STEAM.danger
      : tone === "warning"
        ? STEAM.warning
        : tone === "positive"
          ? STEAM.positive
          : STEAM.textMuted;
  return <div style={{ ...descriptionStyle, color }}>{text}</div>;
}

/** Result rows with one install path and per-row busy state. */
function ResultList({ results, view }: { results: SearchResult[]; view?: string }) {
  // My Addons' list says what is installed, however it got there.
  const { addons, busy } = useSyncExternalStore(addonSession.subscribe, addonSession.get);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const install = async (r: SearchResult, channel?: ReleaseChannel) => {
    const key = resultKey(r);
    setInstalling((m) => ({ ...m, [key]: true }));
    await addonSession.actions.install(r, channel);
    setInstalling((m) => ({ ...m, [key]: false }));
  };
  return (
    <>
      {results.map((r) => {
        const key = resultKey(r);
        const installed = installedAddonFor(addons, r);
        const installLabel = resultInstallLabel(installed);
        const tags = resultTags(installed);
        // An installed addon takes My Addons' update or reinstall path.
        const primary = () =>
          !installed
            ? install(r)
            : installLabel === "Update"
              ? addonSession.actions.update(installed)
              : addonSession.actions.reinstall(installed);
        // Release channel menu (WF-03, Menu button): install from a channel.
        const choices = installChannelChoices(r);
        const channelMenu = choices
          ? (afterPick?: () => void) => {
              // The menu hides the QAM window; that is not a close.
              popupOpening();
              showChoiceMenu("Release channel", choices, undefined, (c) => {
                afterPick?.();
                void install(r, c);
              });
            }
          : undefined;
        return (
          <PanelSectionRow key={key}>
            <AddonResultRow
              memory={view ? focusTarget(view, key) : undefined}
              result={r}
              installing={!!installing[key] || (!!installed && !!busy[installed.id])}
              tags={tags}
              installLabel={installLabel}
              onInstall={() => void primary()}
              onChannelMenu={channelMenu && (() => channelMenu())}
              onDetails={() =>
                openAddonDetailsModal({
                  ...resultDetails(r),
                  installLabel,
                  tags,
                  onInstall: primary,
                  channelMenu,
                })
              }
            />
          </PanelSectionRow>
        );
      })}
    </>
  );
}

export function SearchTab({
  sources,
  installation,
}: {
  sources: SourceControls;
  installation: Installation | null;
}) {
  const { query, results, searching, outcome } = useSyncExternalStore(
    searchDestination.subscribe,
    searchDestination.get,
  );
  // Nothing that searches by name is in use: the pane shows the same guidance
  // screen as Latest and Popular, naming the sources that can search (story
  // 20). Before the sources load there is no answer yet, so the box stays
  // usable and the engine decides.
  const screen = sources.loaded ? zeroCapabilityScreen("nameSearch", sources.providers) : null;
  if (screen) {
    return <ZeroCapabilityScreen screen={screen} onOpenSources={sources.openSources} />;
  }

  const doSearch = () => runSearch(api.rpc);
  const helper = searchHelperText(sources.providers, installationLabel(installation));

  return (
    <>
      <PanelSectionRow>
        <Field
          label="Search addons"
          description={
            outcome.kind !== "none" ? (
              <Status text={outcome.text} tone={outcome.kind === "error" ? "error" : undefined} />
            ) : results === null ? (
              <Status text={helper} />
            ) : undefined
          }
          childrenLayout="below"
          childrenContainerWidth="max"
        >
          <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TextField
                value={query}
                onChange={(e) => searchDestination.patch({ query: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void doSearch();
                  }
                }}
              />
            </div>
            <DialogButton
              style={{ minWidth: 0, width: "auto" }}
              disabled={searching || !query.trim()}
              onClick={doSearch}
            >
              {searching ? <Spinner style={{ width: "1em" }} /> : "Search"}
            </DialogButton>
          </Focusable>
        </Field>
      </PanelSectionRow>
      {results && <ResultList results={results} view={browseFocusView("search")} />}
    </>
  );
}

/** A list that loads LOAD_MORE_PAGE_SIZE at a time (browseDestinations.ts). */
export function ListTab({
  destination,
  emptyText = "No addons found.",
  view,
}: {
  destination: ListDestinationId;
  emptyText?: string;
  /** Focus-memory view (browseSessionState.browseFocusView) to keep the list's place. */
  view?: string;
}) {
  const list = listDestination(destination);
  const state = useSyncExternalStore(list.subscribe, list.get);
  const { loading, error } = state;
  const listRef = useRef<HTMLDivElement>(null);
  // Index of the first row a "Load more" adds: focus goes there afterwards,
  // just below where the user was (guide S21).
  const focusAfterLoad = useRef<number | null>(null);

  useEffect(() => {
    const index = focusAfterLoad.current;
    if (loading || index === null) {
      return;
    }
    focusAfterLoad.current = null;
    const row = listRef.current?.querySelectorAll<HTMLElement>(".wowdeck-result-row")[index];
    // After Steam has added the new rows to its navigation tree; a timer, not
    // requestAnimationFrame (guide G7). Steam's own scroller then keeps the
    // scroll buffer around it.
    if (row) {
      setTimeout(() => row.focus(), 0);
    }
  }, [loading]);

  const fetchMore = () => void loadMore(destination, api.rpc);

  const onLoadMore = () => {
    if (loading) {
      return;
    }
    focusAfterLoad.current = state.results.length;
    fetchMore();
  };

  useEffect(() => {
    if (!state.loaded) {
      fetchMore();
    }
    // Load once per reset; `list` is a stable module object.
  }, [state.loaded]);

  // The pane's scroll container survives destination swaps, so a list that is
  // shown again would open at the previous destination's offset and jump when
  // focus was restored. Reveal the remembered row (without focusing it) on
  // mount and once the first page is in.
  useEffect(() => {
    if (view) {
      revealRemembered(view);
    }
  }, [view, state.loaded]);

  const canLoadMore =
    !error && state.loaded && hasMore(state.results.length, state.totalCount, state.lastPageSize);

  return (
    <div ref={listRef}>
      <ResultList results={state.results} view={view} />
      {error && (
        <PanelSectionRow>
          <Field
            focusable
            label="Retry"
            description={<Status text={error} tone="error" />}
            // Like Load more: focus goes to the first row it brings (the Retry
            // row itself goes away).
            onClick={onLoadMore}
          />
        </PanelSectionRow>
      )}
      {!error && state.loaded && state.results.length === 0 && <Status text={emptyText} />}
      {loading && !canLoadMore && (
        <Spinner style={{ width: "1.5em", margin: "12px auto", display: "block" }} />
      )}
      {/* Stays mounted while loading (spinner inside): removing the focused
          row made Steam move focus to the top of the page. */}
      {canLoadMore && (
        <PanelSectionRow>
          <Field
            focusable
            label={loading ? "Loading…" : "Load more"}
            description={<Status text={`${state.results.length} shown`} />}
            onClick={onLoadMore}
          >
            {loading ? <Spinner style={{ width: "1.2em" }} /> : null}
          </Field>
        </PanelSectionRow>
      )}
    </div>
  );
}

export function ManualInstallTab({ sources }: { sources: SourceControls }) {
  const { url, resolving, resolved, error } = useSyncExternalStore(
    urlDestination.subscribe,
    urlDestination.get,
  );
  const resolve = () => resolveUrl(api.rpc);
  const view = browseFocusView("url");

  return (
    <>
      <PanelSectionRow>
        <Field
          label="From a link"
          description={
            error ? (
              <Status text={error} tone="error" />
            ) : (
              <Status text="A GitHub repository URL, owner/repository or github:owner/repository, a WoWInterface addon URL, or a direct link to a .zip, .rar or .7z file" />
            )
          }
          childrenLayout="below"
          childrenContainerWidth="max"
        >
          <Focusable flow-children="row" style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TextField
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void resolve();
                  }
                }}
              />
            </div>
            <DialogButton
              style={{ minWidth: 0, width: "auto" }}
              disabled={resolving || !url.trim()}
              onClick={resolve}
            >
              {resolving ? <Spinner style={{ width: "1em" }} /> : "Look up"}
            </DialogButton>
          </Focusable>
        </Field>
      </PanelSectionRow>
      <FileImportSection view={view} />
      {resolved && <ResultList results={[resolved]} view={view} />}
      {resolved && <SourceOffNotice sources={sources} providerId={resolved.providerId} />}
    </>
  );
}

/** The preview card's one line under the addon's name. */
function previewLine(p: ArchivePreview): string {
  const bits = [
    p.author ? `by ${p.author}` : "",
    p.version ? `version ${p.version}` : "",
    `${p.folders.length} addon folder${p.folders.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return `${bits.join(" · ")} · ${p.fileName}`;
}

/**
 * Manual Install's From a file (spec: install-from-file): pick an archive
 * with Steam's own file picker, see what the engine found in it, install
 * with one more press. All state lives in the module store
 * (fileImportState.ts) so the picker's popup — which unmounts the whole
 * panel — interrupts nothing; every outcome renders inline here, never a
 * modal.
 */
function FileImportSection({ view }: { view: string }) {
  const file = useSyncExternalStore(fileImport.subscribe, fileImport.get);
  const busy =
    file.phase === "picking" || file.phase === "inspecting" || file.phase === "installing";
  // A failed pick has no preview card yet, so its error takes the helper
  // line's place; a failed install keeps the card and shows it there.
  const pickFailed = file.phase === "error" && !file.preview;

  const browse = () => {
    // Steam's picker hides the QAM window while it is up; that hide is not
    // a close (browseSessionState's popup hold, like a dropdown's menu).
    popupOpening();
    void pickArchive(
      () =>
        openFilePicker(
          FileSelectionType.FILE,
          "/home/deck",
          true,
          false,
          undefined,
          ["zip", "rar", "7z"],
          false,
          false,
        ),
      (path) => api.rpc("addons.inspectArchive", { path }),
    );
  };

  const install = () => {
    const { preview } = fileImport.get();
    if (!preview) {
      return;
    }
    void installArchive((pair) => api.rpc("addons.install", pair));
  };

  return (
    <>
      <PanelSectionRow>
        <Field
          label="From a file"
          description={
            <>
              <Status
                text={
                  pickFailed && file.error
                    ? file.error
                    : "Pick a .zip, .rar or .7z archive on this Deck. Downloads, a USB stick and the SD card all work"
                }
                tone={pickFailed ? "error" : undefined}
              />
              <Status text="Only install archives from sources you trust" />
            </>
          }
          childrenLayout="below"
          childrenContainerWidth="max"
        >
          <FocusSlot view={view} id="file:browse">
            <DialogButton style={{ minWidth: 0, width: "auto" }} disabled={busy} onClick={browse}>
              {file.phase === "picking" || file.phase === "inspecting" ? (
                <Spinner style={{ width: "1em" }} />
              ) : (
                "Browse…"
              )}
            </DialogButton>
          </FocusSlot>
        </Field>
      </PanelSectionRow>
      {file.preview && (
        <PanelSectionRow>
          <Field
            label={file.preview.name}
            description={
              <>
                <Status text={previewLine(file.preview)} />
                {file.phase === "error" && file.error && <Status text={file.error} tone="error" />}
                {file.phase === "success" && (
                  <>
                    <Status text="Installed" tone="positive" />
                    <Status text="It shows as a Local file install in My Addons and never checks for updates" />
                  </>
                )}
              </>
            }
            childrenLayout="below"
            childrenContainerWidth="max"
          >
            <FocusSlot view={view} id="file:install">
              <DialogButton
                style={{ minWidth: 0, width: "auto" }}
                disabled={busy}
                onClick={install}
              >
                {file.phase === "installing" ? <Spinner style={{ width: "1em" }} /> : "Install"}
              </DialogButton>
            </FocusSlot>
          </Field>
        </PanelSectionRow>
      )}
    </>
  );
}

/**
 * Under a From URL result whose source is turned off: it installs, but is not
 * checked for updates until the source is on. Said before the install, with
 * the way to fix it: the Options jump marking that source, like the
 * zero-capability screen (story 18: nothing in Get Addons turns a source on).
 */
function SourceOffNotice({ sources, providerId }: { sources: SourceControls; providerId: string }) {
  const notice = sourceOffNotice(sources.providers, providerId);
  if (!notice) {
    return null;
  }
  return (
    <PanelSectionRow>
      <Field
        focusable
        label="Open addon sources"
        description={<Status text={notice} tone="warning" />}
        onClick={() => sources.openSources([providerId])}
        onOKActionDescription="Open addon sources"
      />
    </PanelSectionRow>
  );
}
