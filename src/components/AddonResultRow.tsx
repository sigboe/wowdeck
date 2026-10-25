import { Field, Spinner } from "@decky/ui";
import { FaDownload, FaRegClock, FaStar } from "react-icons/fa";
import type { SearchResult } from "../types";
import { providerLabel } from "../addonRow";
import { formatDownloadCount, shortReleaseDate } from "../detailsHeader";
import { descriptionStyle } from "../steamTheme";

interface Props {
  result: SearchResult;
  installing: boolean;
  /** Status tags (resultTags): whether it is installed, and recently updated. */
  tags: string[];
  /** What X does (resultInstallLabel); null = X does nothing. */
  installLabel: string | null;
  onInstall: () => void;
  onDetails: () => void;
  /** Opens the Release channel menu (providers with channels only). */
  onChannelMenu?: () => void;
  /**
   * Focus-memory hooks (FocusSlot.focusTarget) for list tabs: the row keeps its
   * place per destination across pane visits. Omitted where place is not kept.
   */
  memory?: {
    preferredFocus?: boolean;
    onGamepadFocus?: () => void;
    ref?: (el: HTMLDivElement | null) => void;
  };
}

/**
 * One addon result (Search, Latest, Popular, URL, Find online source) as a
 * Steam row (guide S14):
 * one focus stop, the thumbnail as the row icon, A opens Details, X installs,
 * Menu picks a release channel to install from (CurseForge, WowUp Hub).
 * There is no Install button: it could not be focused, duplicated X, and made
 * it unclear what A does. Touch and mouse install from Details. An installed
 * addon's status tags (as in My Addons) sit on their own line under the name,
 * beside the icon. The right side shows a spinner while installing, and
 * otherwise the download count, CurseForge favorites and the last update
 * (owner: the count alone looked bare; short lines that cannot wrap, so they
 * never push into the row).
 *
 * UI-02 rev 2: details stay in the existing details modal — the row neither
 * reports focus nor routes into a pane. X installs, or reinstalls or updates an
 * installed addon.
 */
export function AddonResultRow({
  result,
  installing,
  tags,
  installLabel,
  onInstall,
  onDetails,
  onChannelMenu,
  memory,
}: Props) {
  const meta = [
    providerLabel(result.providerId),
    result.author ? `by ${result.author}` : "",
    result.latestVersion ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Field
      focusable
      {...memory}
      className="wowdeck-result-row"
      icon={
        result.thumbnailUrl ? (
          <img src={result.thumbnailUrl} alt="" style={RESULT_ICON} />
        ) : undefined
      }
      label={
        // Status tags on their own line under the name, beside the icon (the
        // description starts under the icon).
        tags.length > 0 ? (
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            {result.name}
            <span style={{ marginTop: "2px", whiteSpace: "nowrap" }}>
              {tags.map((t) => (
                <span key={t} className="wowdeck-status-tag">
                  {t}
                </span>
              ))}
            </span>
          </span>
        ) : (
          result.name
        )
      }
      description={
        <span style={descriptionStyle}>
          {meta}
          {result.summary && (
            <span style={{ display: "block", marginTop: "2px" }}>{result.summary}</span>
          )}
        </span>
      }
      onClick={onDetails}
      onOKActionDescription="Details"
      onSecondaryButton={installing || !installLabel ? undefined : onInstall}
      onSecondaryActionDescription={installing || !installLabel ? undefined : installLabel}
      onMenuButton={installing ? undefined : onChannelMenu}
      onMenuActionDescription={installing || !onChannelMenu ? undefined : "Release channel"}
    >
      <ResultState result={result} installing={installing} />
    </Field>
  );
}

const RESULT_ICON = {
  width: "40px",
  height: "40px",
  borderRadius: "2px",
  objectFit: "cover",
} as const;

function ResultState({ result, installing }: { result: SearchResult; installing: boolean }) {
  const box = {
    ...descriptionStyle,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    whiteSpace: "nowrap" as const,
  };
  if (installing) {
    return <Spinner style={{ width: "1.2em" }} />;
  }
  const downloads =
    result.downloadCount !== null && result.downloadCount > 0
      ? formatDownloadCount(result.downloadCount)
      : null;
  // CurseForge favorites (owner, 2026-10-16); its thumbs-up count is near zero
  // for every addon, so favorites are the signal.
  const favorites =
    result.favoriteCount !== null && result.favoriteCount !== undefined && result.favoriteCount > 0
      ? formatDownloadCount(result.favoriteCount)
      : null;
  const updated = shortReleaseDate(result.releasedAt, new Date());
  if (!downloads && !favorites && !updated) {
    return null;
  }
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px" }}>
      {downloads && (
        <span style={box} aria-label={`${downloads} downloads`}>
          <FaDownload /> {downloads}
        </span>
      )}
      {favorites && (
        <span style={box} aria-label={`${favorites} favorites`}>
          <FaStar /> {favorites}
        </span>
      )}
      {updated && (
        <span style={box} aria-label={`Updated ${updated}`}>
          <FaRegClock /> {updated}
        </span>
      )}
    </span>
  );
}
