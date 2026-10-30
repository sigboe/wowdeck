import type { ReactNode } from "react";
import {
  DialogBody,
  DialogBodyText,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  Focusable,
  ModalRoot,
  NavEntryPositionPreferences,
  Navigation,
  showModal,
} from "@decky/ui";
import { fundingText, inPairs, SUPPORT_HINT, SUPPORT_NOTE } from "../about";
import type { FundingLink } from "../types";
import { QrCode } from "./QrCode";
import { SafeMarkdown } from "./SafeMarkdown";
import { ScrollBuffer } from "./ScrollBuffer";
import { wowdeckSharedStyleCss } from "../sharedStyles";
import { STEAM, descriptionStyle } from "../steamTheme";
import { useDirectScroll } from "../useDirectScroll";

/** The direct-scrolled body's height cap: the modal keeps its header and Close button on screen. */
const BODY_MAX_HEIGHT = "60vh";

/**
 * How the body scrolls: "direct" (read-only text, after the release notes
 * modal: Close is the one focus target and D-pad/stick Up/Down scroll the
 * body through valveScroll) or "focus" (a body of focusable rows, the
 * Funding links: the D-pad moves focus, and Steam's focus engine scrolls
 * DialogBody with Valve's scroll buffer, ScrollBuffer, guide S21).
 */
export type AboutModalScroll = "direct" | "focus";

/**
 * A modal for an Options › About row, after the release notes modal
 * (ReleaseNotesModal). B, or A on Close, closes it.
 */
function AboutModal({
  title,
  scroll,
  children,
  closeModal,
}: {
  title: string;
  scroll: AboutModalScroll;
  children: ReactNode;
  closeModal?: () => void;
}) {
  const direct = scroll === "direct";
  const { boxRef, onGamepadDirection } = useDirectScroll(direct);

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal} bAllowFullSize={!direct}>
      <DialogHeader>{title}</DialogHeader>
      <DialogBody>
        <style>{wowdeckSharedStyleCss()}</style>
        {direct ? (
          <div
            ref={boxRef}
            style={{
              ...descriptionStyle,
              maxHeight: BODY_MAX_HEIGHT,
              overflowY: "auto",
              overflowWrap: "anywhere",
            }}
          >
            {children}
          </div>
        ) : (
          // DialogBody is the scroller: no overflow box of our own between
          // the rows and it (S21).
          <ScrollBuffer>{children}</ScrollBuffer>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogButton
          onClick={closeModal}
          onGamepadDirection={direct ? onGamepadDirection : undefined}
        >
          Close
        </DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

/**
 * Open an About modal over Options; `body` scrolls inside it. `body` gets
 * the modal's close, which a link calls as it opens Steam's browser: a
 * modal left open under the browser took the player's first B out of sight
 * (DEVICE 2026-10-30).
 */
export function openAboutModal(
  title: string,
  body: (close: () => void) => ReactNode,
  scroll: AboutModalScroll = "direct",
): void {
  const close = () => modalResult.Close();
  const modalResult = showModal(
    <AboutModal title={title} scroll={scroll} closeModal={close}>
      {body(close)}
    </AboutModal>,
    window,
    { strTitle: title, bHideMainWindowForPopouts: false },
  );
}

/** Open `url` in Steam's browser, closing the About modal first. */
function openInBrowser(url: string, closeModal: () => void): void {
  closeModal();
  Navigation.NavigateToExternalWeb(url);
}

/**
 * Markdown the project wrote (the third-party notices), rendered with the
 * shared renderer. Its source lines are wrapped, so a single newline is not
 * a line break. A link closes the modal, then opens.
 */
export function AboutMarkdown({
  markdown,
  closeModal,
}: {
  markdown: string;
  closeModal: () => void;
}) {
  return (
    <SafeMarkdown
      markdown={markdown}
      breaks={false}
      onLink={(url) => openInBrowser(url, closeModal)}
    />
  );
}

/**
 * A web link's short URL stays on one line, cut with Valve's ellipsis in
 * the rare case it is wider than the tile (the QR code holds the full
 * link). A Bitcoin address wraps, since the player checks all of it.
 */
const webUrlStyle = {
  ...descriptionStyle,
  display: "block",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;
const bitcoinAddressStyle = { ...descriptionStyle, overflowWrap: "anywhere" } as const;

/** Space between Funding tiles, both ways: above Steam's 6 px between rows (S10). */
const TILE_GAP = "8px";

/**
 * One Funding link in the Support grid, one focus stop (S9): its name and
 * short URL, its QR code below them, so the URL gets the tile's full width
 * and never breaks mid-word. A on a web link closes the modal and opens
 * the link in Steam's browser. A Bitcoin tile shows the full address
 * instead, its code is the `bitcoin:` URI a wallet scans, and A does
 * nothing there. Names and URLs are React text, never HTML.
 */
function FundingTile({ link, closeModal }: { link: FundingLink; closeModal: () => void }) {
  return (
    <Field
      focusable
      childrenLayout="below"
      label={link.name}
      description={
        <span style={link.kind === "web" ? webUrlStyle : bitcoinAddressStyle}>
          {fundingText(link)}
        </span>
      }
      {...(link.kind === "web" && {
        onClick: () => openInBrowser(link.url, closeModal),
        onOKActionDescription: "Open in browser",
      })}
    >
      <QrCode value={link.url} />
    </Field>
  );
}

/**
 * The Support WoWDeck body (a "focus" modal): the owner's note, then the
 * Funding links two to a row (inPairs), so six links scroll three rows
 * instead of six. Each row is a `flow-children="row"` group (F7): Left/Right
 * move within it, and MAINTAIN_X keeps the column on Up/Down (F6). Each
 * tile sits in its own column div, so Steam's 6 px between sibling rows
 * never applies: TILE_GAP spaces them instead. An odd last link keeps the
 * left column's width.
 */
export function AboutFunding({
  links,
  closeModal,
}: {
  links: FundingLink[];
  closeModal: () => void;
}) {
  return (
    <>
      <DialogBodyText>{SUPPORT_NOTE}</DialogBodyText>
      <DialogBodyText style={{ color: STEAM.textMuted }}>{SUPPORT_HINT}</DialogBodyText>
      <DialogControlsSection>
        <div style={{ display: "flex", flexDirection: "column", gap: TILE_GAP }}>
          {inPairs(links).map((row) => (
            <Focusable
              key={row[0]!.url}
              flow-children="row"
              navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
              style={{ display: "flex", gap: TILE_GAP }}
            >
              {[0, 1].map((column) => {
                const link = row[column];
                return (
                  <div key={link?.url ?? column} style={{ flex: "1 1 0", minWidth: 0 }}>
                    {link && <FundingTile link={link} closeModal={closeModal} />}
                  </div>
                );
              })}
            </Focusable>
          ))}
        </div>
      </DialogControlsSection>
    </>
  );
}

/**
 * Names from fetched data (the Supporters), one per line as React text:
 * never Markdown or HTML, so a name can't inject formatting or links.
 */
export function AboutNames({ names }: { names: string[] }) {
  return (
    <ul style={{ listStyle: "none", marginTop: 0, marginBottom: 0, paddingLeft: 0 }}>
      {names.map((name) => (
        <li key={name} style={{ paddingTop: "2px", paddingBottom: "2px" }}>
          {name}
        </li>
      ))}
    </ul>
  );
}
