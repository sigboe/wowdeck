import { useEffect, useRef, useState } from "react";
import {
  DialogButton,
  Field,
  Focusable,
  GamepadButton,
  ModalRoot,
  Navigation,
  showModal,
  type GamepadEvent,
} from "@decky/ui";
import { canScroll } from "../scrollEdge";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import type { DetailsResult, SearchResult, SearchResultScreenshot } from "../types";
import * as api from "../services/backend";
import { useLazyResource } from "../useLazyResource";
import { dependencyNote, headerFacts, type DependencyNote } from "../detailsHeader";
import { providerLabel } from "../addonRow";
import { FactLine } from "./FactLine";
import {
  relationshipCount,
  relationshipGroups,
  type RelationshipGroup,
  type Relationships,
} from "../relationships";
import { wowdeckSharedStyleCss } from "../sharedStyles";
import { STEAM, STEAM_FONT, descriptionStyle } from "../steamTheme";
import {
  nextSelectableId,
  registerDirectionalNav,
  registerShoulderNav,
  swipeDirection,
} from "../shoulderNav";
import { registerDirectScroll, scrollTweenTarget } from "../valveScroll";
import { nextGalleryIndex } from "../gallery";
import { holdBrowseSessionForModal } from "../browseSessionState";
import { renderMarkdownToSafeHtml } from "../markdown";
import { clearModalDimming, stripModalChrome } from "../steamDom/modalChrome";

type Section = "description" | "changelog" | "relationships" | "gallery";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "description", label: "Description" },
  { id: "changelog", label: "Changelog" },
  { id: "gallery", label: "Gallery" },
  // Only when there is something to show (WF-11; CurseForge's website tab).
  { id: "relationships", label: "Relationships" },
];

/**
 * Steam's news view (DEVICE, read-only CDP): on the Deck a page is 683 px of
 * 854 (80 %): a 635 px card plus 24 px each side, so the neighbouring cards
 * peek in at both edges. Pages start below Steam's 40 px top bar and run to
 * the bottom of the screen, behind the footer legend (which has its own blur);
 * the page scroller keeps `scroll-padding: 68px 0 56px`. The card is at most
 * 640 px. A page is never wider than its card plus padding (688 px), so on a
 * bigger screen the neighbours still show at the sides (owner, 2026-10-15:
 * an 80 %-wide page at 1080p pushed them off screen).
 */
const PAGE_WIDTH = "min(80vw, 688px)";
const STAGE_TOP_PX = 40;

const DETAILS_STAGE_CSS = `
.wowdeck-details-stage { position: fixed; inset: 0; z-index: 1; }
.wowdeck-details-backdrop {
  position: fixed; inset: 0; overflow: hidden;
  backdrop-filter: blur(5px) brightness(0.65) saturate(0.7);
}
.wowdeck-details-track {
  position: absolute; top: ${STAGE_TOP_PX}px; left: 0; bottom: 0;
  display: flex; width: max-content;
  transform: translateX(calc((100vw - ${PAGE_WIDTH}) / 2 - var(--wowdeck-page-index, 0) * ${PAGE_WIDTH}));
  transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.wowdeck-details-page {
  width: ${PAGE_WIDTH}; height: 100%; box-sizing: border-box;
  padding: 24px; overflow-y: auto; scrollbar-width: none; font-weight: 300;
  scroll-padding: 68px 0 56px;
}
.wowdeck-details-card {
  max-width: 640px; margin: 0 auto 40px; overflow: hidden; position: relative;
  background-color: rgb(37, 40, 46);
  background-image: radial-gradient(at left top, rgb(66, 69, 76), rgb(37, 40, 46));
}
.wowdeck-details-card.on { outline: 2px solid rgba(255, 255, 255, 0.6); outline-offset: 2px; }
.wowdeck-details-header {
  padding: 16px 24px 12px;
  box-shadow: rgba(0, 0, 0, 0.2) 0 0 15px;
  background-image: radial-gradient(at center bottom, rgba(255, 255, 255, 0.1) 10%, rgba(255, 255, 255, 0) 80%);
}
.wowdeck-details-body { padding: 24px; min-height: 160px; font-size: 14px; line-height: 19px; color: rgb(207, 210, 211); }
.wowdeck-details-dots { position: absolute; bottom: 52px; left: 0; right: 0; display: flex; justify-content: center; gap: 6px; pointer-events: none; }
.wowdeck-details-dots span { width: 6px; height: 6px; border-radius: 50%; background: rgba(255, 255, 255, 0.3); }
.wowdeck-details-dots span.on { background: rgba(255, 255, 255, 0.9); }
`;

interface ModalProps {
  result: DetailsResult;
  onInstall: () => Promise<void>;
  closeModal?: () => void;
  /** Called when the modal unmounts (openAddonDetailsModal's session hold). */
  releaseHold?: () => void;
  /**
   * Optional hero banner shown above the header, Steam-news style
   * (a 635:214 image). Nothing is rendered when absent — no caller
   * supplies one yet; the prop exists so a per-game banner can be added
   * later without reshaping the modal.
   */
  bannerUrl?: string | null;
  /** Label of the X action ("Install", "Reinstall", "Update"); null = no X action. */
  installLabel: string | null;
  /** Status tags under the name (Get Addons: Installed, Update available, Updated). */
  tags?: string[];
  /**
   * Opens the Release channel menu (WF-03; Menu button in the footer);
   * absent for providers without channels. `afterPick` closes the modal,
   * like every other action here.
   */
  channelMenu?: (afterPick: () => void) => void;
  /** Required dependencies line under the status line (WF-11); none when null. */
  dependencies?: DependencyNote | null;
  /** The Relationships page's content; the page exists only when this has entries. */
  relationships?: Relationships | null;
}

/**
 * The identity block of the details header: logo, name, provider pill and
 * facts, and the dependencies line — the modal's own header content, shared
 * with the widened QAM's detail pane (UI-02 ticket 03, glossary "Identity
 * strip"). It owns no chrome: the modal wraps it in .wowdeck-details-header
 * under the per-page headline, the pane in its own strip.
 */
function AddonDetailsIdentity({
  result,
  tags,
  dependencies,
}: {
  result: DetailsResult;
  tags?: string[];
  dependencies?: DependencyNote | null;
}) {
  const facts = headerFacts(result);
  return (
    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
      {result.thumbnailUrl && (
        <img
          src={result.thumbnailUrl}
          alt=""
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "6px",
            objectFit: "cover",
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: STEAM_FONT.body }}>{result.name}</div>
        {tags && tags.length > 0 && (
          <div style={{ margin: "2px 0" }}>
            {tags.map((t) => (
              <span key={t} className="wowdeck-status-tag">
                {t}
              </span>
            ))}
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "flex-start",
            color: STEAM.textMuted,
            fontSize: STEAM_FONT.small,
          }}
        >
          <span
            style={{
              background: "rgba(255,255,255,0.12)",
              color: STEAM.text,
              borderRadius: "2px",
              padding: "0 6px",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {providerLabel(result.providerId)}
          </span>
          {/* Wraps only between facts (owner, 2026-10-16). */}
          <FactLine facts={facts} style={{ flex: "1 1 0" }} />
        </div>
        {dependencies && (
          <div
            style={{
              color: STEAM.textMuted,
              fontSize: STEAM_FONT.small,
              marginTop: "2px",
            }}
          >
            {dependencies.text}
            {dependencies.missing && (
              <span style={{ color: STEAM.warning }}> · {dependencies.missing}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Addon Details modal (openAddonDetailsModal below): Get Addons results and
 * My Addons rows.
 *
 * Modelled on Steam's own news-item modal (§8.4b of
 * docs/UI_DEVELOPMENT_BEST_PRACTICES.md): a header (icon, name, tag line),
 * then one "page" at a time — Description, Changelog, Gallery — each with
 * its title as the headline. LB/RB and D-pad/stick Left/Right switch pages
 * (clamped, disabled pages skipped). The actions live on the controller
 * buttons: Y = View on <provider>, X = Install, Menu = Release channel
 * (providers with channels), B = close.
 *
 * Description/Changelog are fetched lazily, once per section per modal
 * instance (useLazyResource) — loading/error/empty are three *distinct* rendered
 * states, not collapsed into one: a thrown NetworkError must not render
 * the same as "this addon genuinely has no changelog". Gallery needs no
 * fetch at all — screenshots already arrive on the SearchResult from the
 * same list request that produced this row.
 *
 * Wrapped in Decky's own ModalRoot rather than a bespoke overlay: it
 * supplies the backdrop, the controller/B-button + visible close icon,
 * and the focus-trap that keeps gamepad navigation from reaching
 * anything behind the modal.
 *
 * Y and X live only in Steam's footer legend (DEVICE): the page is a
 * `Field focusable`, so focus sits on the element that carries the legend
 * props. Both actions close the modal; X is absent when `installLabel` is
 * null.
 */
function AddonDetailsModal({
  result,
  onInstall,
  closeModal,
  releaseHold,
  bannerUrl,
  installLabel,
  tags,
  channelMenu,
  dependencies,
  relationships,
}: ModalProps) {
  const [section, setSection] = useState<Section>("description");
  const [installing, setInstalling] = useState(false);

  const {
    value: description,
    loading: descLoading,
    error: descError,
  } = useLazyResource(() =>
    api
      .rpc("addons.getDescription", {
        providerId: result.providerId,
        externalId: result.externalId,
      })
      .then((r) => r.description),
  );
  const {
    value: changelog,
    loading: cngLoading,
    error: cngError,
  } = useLazyResource(() =>
    api
      .rpc("addons.getChangelog", { providerId: result.providerId, externalId: result.externalId })
      .then((r) => r.changelog),
  );

  // Carousel pages. Gallery exists only when the result has screenshots;
  // Description/Changelog can't be known to be empty in advance (lazy-fetched
  // per provider), so they keep their empty-state text.
  const relCount = relationshipCount(relationships);
  const pages = SECTIONS.filter(
    (p) =>
      (p.id !== "gallery" || result.screenshots.length > 0) &&
      (p.id !== "relationships" || relCount > 0),
  );

  // Names for a provider's dependency ids, fetched once (the ids alone are
  // what the search result carries).
  const providerRels = relationships?.kind === "provider" && relCount > 0 ? relationships : null;
  const { value: relNames, error: relError } = useLazyResource(
    providerRels &&
      (() =>
        api
          .rpc("addons.lookup", {
            providerId: providerRels.providerId,
            externalIds: providerRels.items.map((i) => i.externalId),
          })
          .then((r) => r.addons)),
  );
  const selectableIds = pages.map((p) => p.id);
  const activeIndex = Math.max(0, selectableIds.indexOf(section));

  // LB/RB and D-pad/stick Left/Right page through the sections, reusing
  // the plugin's raw-input helpers and their clamp-not-wrap convention.
  // No conflict with the top-level TopNav handler: opening this modal
  // unmounts the whole QAM panel underneath it (see openAddonDetailsModal),
  // which tears down that registration for as long as this one is open.
  // `galleryOpenRef` is the one thing that *does* need an explicit guard —
  // the enlarged Gallery image viewer is a second modal stacked *on top*
  // of this one without unmounting it, and it owns LB/RB/Left/Right while
  // it is up.
  const galleryOpenRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef<Partial<Record<Section, HTMLDivElement | null>>>({});
  // Touch paging (PC-06): the track moves by transform, not by scrolling, so a
  // sideways swipe is read from the touch itself and turns the page the same
  // way L1/R1 do (same transition). One finger only.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    const t = e.changedTouches[0];
    touchStart.current = null;
    if (!start || !t || galleryOpenRef.current) {
      return;
    }
    const direction = swipeDirection(t.clientX - start.x, t.clientY - start.y);
    if (direction !== 0) {
      setSection((prev) => nextSelectableId(prev, direction, selectableIds));
    }
  };
  useEffect(() => {
    const move = (direction: -1 | 1) => {
      if (galleryOpenRef.current) {
        return;
      }
      setSection((prev) => nextSelectableId(prev, direction, selectableIds));
    };
    const offShoulder = registerShoulderNav(
      () => move(-1),
      () => move(1),
    );
    const offDirectional = registerDirectionalNav(
      () => move(-1),
      () => move(1),
    );
    return () => {
      offShoulder();
      offDirectional();
    };
    // selectableIds' membership only ever depends on the fixed SECTIONS
    // list plus this one result's screenshot and relationship counts, which
    // never change for the lifetime of a single modal instance.
  }, [result.screenshots.length, relCount]);

  useEffect(() => {
    stripModalChrome(stageRef.current);
    return clearModalDimming(stageRef.current);
  }, []);

  // Releases the browse-session hold taken before showModal (PC-09): every way
  // the modal closes unmounts it.
  useEffect(() => releaseHold, []);

  // News-style scrolling: every page is its own vertical scroller, so a
  // neighbouring page keeps its scroll position (DEVICE, §8.4b-2). Raw
  // Up/Down scrolls the way Valve's gamepad-scroll regions do
  // (docs/valve-bpm-scrolling.md §3.3): 30 % of the page per press as a
  // 300–500 ms sine tween, held after 400 ms then every 50 ms, each repeat
  // retargeting from the running tween's target at linear timing — so a held
  // D-pad glides at constant speed (the gallery included).
  useEffect(() => {
    return registerDirectScroll(() => pageEls.current[section] ?? null);
  }, [section]);

  const install = async () => {
    if (installing) {
      return;
    }
    setInstalling(true);
    try {
      await onInstall();
    } finally {
      setInstalling(false);
      closeModal?.();
    }
  };

  const viewOnSource = () => {
    // Only ever opens a URL the provider itself gave us on this exact
    // result (never constructed from addon name/id), using @decky/ui's
    // officially-exported Navigation helper rather than window.open
    // (unavailable/unsupported in this runtime).
    if (result.websiteUrl) {
      Navigation.NavigateToExternalWeb(result.websiteUrl);
      closeModal?.();
    }
  };

  const viewLabel = `View on ${providerLabel(result.providerId)}`;

  // Carried by the page `Field`, the one focus target, so the
  // Y/X actions show in Steam's footer on every page.
  const legendProps = {
    onOptionsActionDescription: result.websiteUrl ? viewLabel : undefined,
    onOptionsButton: result.websiteUrl ? viewOnSource : undefined,
    onSecondaryActionDescription: installLabel
      ? installing
        ? `${installLabel}…`
        : installLabel
      : undefined,
    onSecondaryButton: installLabel ? install : undefined,
    onMenuActionDescription: channelMenu ? "Release channel" : undefined,
    onMenuButton: channelMenu ? () => channelMenu(() => closeModal?.()) : undefined,
  };

  // The page is one focus target, so Steam treats every D-pad press as a
  // failed move and rings its "can't move" bell, even while we scroll. Like
  // Steam's own ScrollPanel: return true (handled, no sound) while the page
  // can still scroll or page that way; false at the edge, so Steam's
  // navigation runs, finds nothing and rings once (guide S29). Held presses at
  // an edge are swallowed: one bell per press. Scrolling and paging themselves
  // stay with the direct-scroll and directional handlers above. The Up/Down
  // test reads the scroll TWEEN's target, not the live scrollTop (which lags
  // behind the running animation): at the target's edge a press must ring at
  // once, not after the last tween settles (§3.1's target trick).
  const onGamepadDirection = (evt: GamepadEvent): boolean => {
    const { button, is_repeat } = evt.detail;
    let canMove: boolean;
    if (button === GamepadButton.DIR_UP || button === GamepadButton.DIR_DOWN) {
      const page = pageEls.current[section];
      canMove =
        !!page &&
        canScroll(button === GamepadButton.DIR_UP ? "up" : "down", {
          scrollTop: scrollTweenTarget(page),
          scrollHeight: page.scrollHeight,
          clientHeight: page.clientHeight,
        });
    } else if (button === GamepadButton.DIR_LEFT || button === GamepadButton.DIR_RIGHT) {
      const next = activeIndex + (button === GamepadButton.DIR_LEFT ? -1 : 1);
      canMove = next >= 0 && next < selectableIds.length;
    } else {
      return false;
    }
    return canMove || !!is_repeat;
  };

  const enlargeCentredImage = () => {
    const page = pageEls.current.gallery;
    if (!page) {
      return;
    }
    const mid = window.innerHeight / 2;
    let best: { index: number; dist: number } | null = null;
    page.querySelectorAll<HTMLElement>("[data-gallery-index]").forEach((img) => {
      const r = img.getBoundingClientRect();
      const dist = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
      if (!best || dist < best.dist) {
        best = { index: Number(img.dataset.galleryIndex), dist };
      }
    });
    if (best) {
      openGalleryViewer(result.screenshots, (best as { index: number }).index, galleryOpenRef);
    }
  };

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal} bAllowFullSize>
      <style>{wowdeckSharedStyleCss() + DETAILS_STAGE_CSS}</style>
      <Field
        focusable
        highlightOnFocus={false}
        padding="none"
        bottomSeparator="none"
        childrenLayout="below"
        childrenContainerWidth="max"
        className="wowdeck-details-stage"
        {...legendProps}
        onGamepadDirection={onGamepadDirection as (evt: GamepadEvent) => void}
        {...(section === "gallery"
          ? { onOKActionDescription: "Enlarge", onOKButton: enlargeCentredImage }
          : {})}
      >
        <div
          ref={stageRef}
          className="wowdeck-root wowdeck-details-backdrop"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => (touchStart.current = null)}
        >
          <div
            className="wowdeck-details-track"
            style={{ ["--wowdeck-page-index" as string]: activeIndex }}
          >
            {pages.map((p) => (
              <div
                key={p.id}
                ref={(el) => {
                  pageEls.current[p.id] = el;
                }}
                className="wowdeck-details-page"
              >
                <div
                  className={p.id === section ? "wowdeck-details-card on" : "wowdeck-details-card"}
                >
                  {bannerUrl && p.id === "description" && (
                    <img
                      src={bannerUrl}
                      alt=""
                      style={{
                        display: "block",
                        width: "100%",
                        aspectRatio: "635 / 214",
                        objectFit: "cover",
                      }}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                  <div className="wowdeck-details-header">
                    <AddonDetailsIdentity result={result} tags={tags} dependencies={dependencies} />
                    <div
                      style={{
                        // Steam's news headline: 24 px / 500, 36 px line (§8.4b-2).
                        fontSize: "24px",
                        fontWeight: 500,
                        lineHeight: "36px",
                        marginTop: "12px",
                      }}
                    >
                      {p.label}
                    </div>
                  </div>
                  <div className="wowdeck-details-body">
                    {p.id === "description" && (
                      <DetailsText
                        loading={descLoading}
                        error={descError}
                        text={description}
                        emptyLabel="No description available."
                      />
                    )}
                    {p.id === "changelog" && (
                      <DetailsText
                        loading={cngLoading}
                        error={cngError}
                        text={changelog}
                        emptyLabel="No changelog available."
                      />
                    )}
                    {p.id === "relationships" && relationships && (
                      <RelationshipsSection
                        groups={relationshipGroups(relationships, relNames)}
                        loading={relationships.kind === "provider" && !relNames && !relError}
                        error={relError}
                      />
                    )}
                    {p.id === "gallery" && (
                      <GallerySection
                        screenshots={result.screenshots}
                        galleryOpenRef={galleryOpenRef}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="wowdeck-details-dots">
            {pages.map((p) => (
              <span key={p.id} className={p.id === section ? "on" : undefined} />
            ))}
          </div>
        </div>
      </Field>
    </ModalRoot>
  );
}

/**
 * The Relationships page (WF-11): dependencies grouped as on CurseForge's
 * website, each with what it means here, a thumbnail when the provider has
 * one, and whether it is installed (or missing, for an installed addon).
 * Read-only, like the other pages: the page is one focus target.
 */
function RelationshipsSection({
  groups,
  loading,
  error,
}: {
  groups: RelationshipGroup[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {loading && <span style={descriptionStyle}>Loading…</span>}
      {error && (
        <span style={{ ...descriptionStyle, color: STEAM.danger }}>
          Couldn't load the names. Try again later.
        </span>
      )}
      {groups.map((g) => (
        <div key={g.title}>
          <div style={{ fontSize: "19px", fontWeight: "bold" }}>{g.title}</div>
          <div style={{ ...descriptionStyle, margin: "2px 0 8px" }}>{g.note}</div>
          {g.rows.map((r) => (
            <div
              key={r.key}
              style={{ display: "flex", alignItems: "center", gap: "12px", padding: "6px 0" }}
            >
              {r.thumbnailUrl ? (
                <img
                  src={r.thumbnailUrl}
                  alt=""
                  style={{ width: "32px", height: "32px", borderRadius: "2px", objectFit: "cover" }}
                />
              ) : (
                <span style={{ width: "32px", height: "32px", flexShrink: 0 }} />
              )}
              <span style={{ flex: 1, minWidth: 0 }}>{r.name}</span>
              {r.tag && (
                <span
                  className="wowdeck-status-tag"
                  style={r.tag === "Missing" ? { color: STEAM.warning } : undefined}
                >
                  {r.tag}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * One section's text (description / changelog) in the three states anything
 * lazily fetched can be in (modal comment above; shared with the detail
 * pane's body, UI-02 ticket 03).
 */
function DetailsText({
  loading,
  error,
  text,
  emptyLabel,
}: {
  loading: boolean;
  error: string | null;
  text: string | null;
  emptyLabel: string;
}) {
  if (loading) {
    return <span style={{ ...descriptionStyle }}>Loading…</span>;
  }
  if (error) {
    return (
      <span style={{ ...descriptionStyle, color: STEAM.danger }}>
        Couldn't load this page. Try again later.
      </span>
    );
  }
  if (!text) {
    return <span style={{ ...descriptionStyle }}>{emptyLabel}</span>;
  }
  // GitHub READMEs/release notes and WowInterface descriptions are real
  // Markdown — rendered here via renderMarkdownToSafeHtml (marked +
  // DOMPurify, see src/markdown.ts), never raw/unsanitized: this is
  // third-party text from an arbitrary repo or addon listing, not
  // something this project authored.
  //
  // Links inside the rendered HTML are pointer-only (U-18): Steam's own
  // news view has the same limit, so there is deliberately no gamepad
  // links row. No scroll container here: the whole modal page scrolls.
  return (
    <div
      className="wowdeck-markdown"
      onClick={(e) => {
        const anchor = (e.target as HTMLElement).closest("a");
        if (anchor?.href) {
          e.preventDefault();
          Navigation.NavigateToExternalWeb(anchor.href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(text) }}
    />
  );
}

/**
 * The section's screenshot stack (shared with the detail pane's body, UI-02
 * ticket 03): images at natural size capped at the column width, A enlarges
 * the image at the screen's vertical centre (data-gallery-index), a pointer
 * press enlarges the one pressed.
 */
function GallerySection({
  screenshots,
  galleryOpenRef,
}: {
  screenshots: SearchResult["screenshots"];
  galleryOpenRef: React.MutableRefObject<boolean>;
}) {
  if (!screenshots.length) {
    return <span style={{ ...descriptionStyle }}>No gallery images available.</span>;
  }
  // A vertical stack, images at natural size capped at the column width. Like every page it scrolls with
  // Up/Down on the page itself (the page `Field` is the only focus target,
  // so Steam never scrolls to a focused image); A enlarges the image at the
  // screen's vertical centre (`data-gallery-index`), a pointer press
  // enlarges the one pressed.
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      {screenshots.map((s, i) => (
        <div key={`${s.url}:${i}`}>
          {i > 0 && (
            <hr
              style={{
                border: "none",
                borderTop: "1px solid rgba(255,255,255,0.15)",
                margin: "12px 0",
              }}
            />
          )}
          <img
            data-gallery-index={i}
            src={s.thumbnailUrl ?? s.url}
            alt={s.title ?? ""}
            style={{
              // Natural size, capped at the column width: never scaled up.
              maxWidth: "100%",
              width: "auto",
              height: "auto",
              borderRadius: "4px",
              display: "block",
              cursor: "pointer",
            }}
            onClick={() => openGalleryViewer(screenshots, i, galleryOpenRef)}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          {s.title && (
            <div
              style={{
                marginTop: "6px",
                fontSize: STEAM_FONT.small,
                color: STEAM.textMuted,
                overflowWrap: "anywhere",
              }}
            >
              {s.title}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Enlarged image viewer: a second showModal stacked on top of the
 * Details modal. Verified on the Steam Deck before committing to this
 * architecture over a single-modal-state fallback — nested modals keep
 * focus, B-button close, and scroll all working correctly; the
 * underlying Details modal is untouched and intact (and still mounted,
 * unlike the QAM panel when the *Details* modal itself opens) once this
 * one closes.
 */
function GalleryViewerContent({
  screenshots,
  startIndex,
  onOpenChange,
}: {
  screenshots: SearchResultScreenshot[];
  startIndex: number;
  /**
   * Tells the (still-mounted) Details modal underneath whether this
   * viewer is up, so its own LB/RB handler can ignore presses while the
   * user is actually looking at a gallery image.
   * Mount/unmount-driven (not tied to any dismissal-path-specific
   * callback) so it's correct however this modal closes — explicit
   * Close(), B-button, or backdrop.
   */
  onOpenChange: (open: boolean) => void;
}) {
  useEffect(() => {
    onOpenChange(true);
    return () => onOpenChange(false);
  }, [onOpenChange]);

  const [index, setIndex] = useState(startIndex);
  const [loadError, setLoadError] = useState(false);
  const current = screenshots[index]!;

  const go = (delta: number) => {
    setLoadError(false);
    setIndex((i) => nextGalleryIndex(i, delta, screenshots.length));
  };

  // D-pad/left-stick Left/Right also step through images, not just the
  // on-screen chevron buttons — registered
  // only while this viewer is mounted, same lifecycle-scoping as
  // registerShoulderNav elsewhere in the plugin. Uses the functional
  // setState form directly (not the outer `go`) so the effect never
  // needs to re-run just because `index` changed.
  const count = screenshots.length;
  useEffect(() => {
    if (count <= 1) {
      return;
    }
    const step = (delta: number) => {
      setLoadError(false);
      setIndex((i) => nextGalleryIndex(i, delta, count));
    };
    return registerDirectionalNav(
      () => step(-1),
      () => step(1),
    );
  }, [count]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
      <div
        style={{
          width: "100%",
          height: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {loadError ? (
          <span style={{ color: STEAM.danger }}>Couldn't load this image.</span>
        ) : (
          // Only the current image is ever given a real src — prev/next
          // images aren't preloaded, so opening the gallery never fetches
          // more than one full-resolution image at a time.
          <img
            src={current.url}
            alt={current.title ?? ""}
            style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" }}
            onError={() => setLoadError(true)}
          />
        )}
      </div>
      {screenshots.length > 1 && (
        <Focusable
          flow-children="row"
          style={{ display: "flex", gap: "8px", justifyContent: "center", alignItems: "center" }}
        >
          <DialogButton
            style={{ minWidth: 0, width: "auto", padding: "10px 16px" }}
            onClick={() => go(-1)}
            onOKActionDescription="Previous image"
          >
            <FaChevronLeft />
          </DialogButton>
          <span style={{ ...descriptionStyle, padding: "0 8px" }}>
            {index + 1} / {screenshots.length}
          </span>
          <DialogButton
            style={{ minWidth: 0, width: "auto", padding: "10px 16px" }}
            onClick={() => go(1)}
            onOKActionDescription="Next image"
          >
            <FaChevronRight />
          </DialogButton>
        </Focusable>
      )}
    </div>
  );
}

function openGalleryViewer(
  screenshots: SearchResultScreenshot[],
  startIndex: number,
  galleryOpenRef: React.MutableRefObject<boolean>,
): void {
  const close = () => modalResult.Close();
  const element = (
    <ModalRoot onCancel={close} closeModal={close}>
      <div className="wowdeck-root">
        <style>{wowdeckSharedStyleCss() + DETAILS_STAGE_CSS}</style>
        <GalleryViewerContent
          screenshots={screenshots}
          startIndex={startIndex}
          onOpenChange={(open) => {
            galleryOpenRef.current = open;
          }}
        />
      </div>
    </ModalRoot>
  );
  const modalResult = showModal(element, window, {
    strTitle: "Gallery",
    bHideMainWindowForPopouts: false,
  });
}

/** What a caller gives: the modal wires its own closing and session hold. */
export type OpenAddonDetailsModalProps = Omit<ModalProps, "closeModal" | "releaseHold">;

/**
 * Details of a provider result (Get Addons, Find online source): the
 * required-dependency count and the Relationships page come from the
 * provider's own answer.
 */
export function resultDetails(
  result: SearchResult,
): Pick<OpenAddonDetailsModalProps, "result" | "dependencies" | "relationships"> {
  return {
    result,
    dependencies: dependencyNote({ count: result.requiredDependencies ?? 0 }),
    relationships: {
      kind: "provider",
      providerId: result.providerId,
      items: result.relationships ?? [],
    },
  };
}

/**
 * Opens the Details modal for one addon result. The element's `closeModal`
 * needs the `Close` that `showModal` returns only afterwards, so it reads it
 * through a closure. `bHideMainWindowForPopouts: false` restores showModal's
 * default, which passing our own props object replaces. Any modal unmounts
 * the QAM panel underneath (guide G4); the state that must survive lives in
 * module stores.
 */
export function openAddonDetailsModal(props: OpenAddonDetailsModalProps): void {
  const close = () => modalResult.Close();
  // Taken before showModal: showing the modal hides the QAM, and that hide
  // must find the hold already in place (PC-09).
  const releaseHold = holdBrowseSessionForModal();
  const element = <AddonDetailsModal {...props} closeModal={close} releaseHold={releaseHold} />;
  const modalResult = showModal(element, window, {
    strTitle: props.result.name,
    bHideMainWindowForPopouts: false,
  });
}
