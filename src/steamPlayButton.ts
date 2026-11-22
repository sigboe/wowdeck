import {
  cloneElement,
  createElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * Class names from Steam's Play button CSS module. The prop sniffs below
 * (label, chevron, explainer, menu rows, mouse-up or click) are G13
 * INFERRED; docs/ui/device-notes.md §8.4e says what each does and what
 * happens without it.
 */
export interface PlayButtonClasses {
  container: string;
  playButton: string;
  hasRemoteText: string;
  showingStreaming: string;
  buttonText: string;
  buttonRemoteText: string;
}

export interface PlayButtonPatch {
  classes: PlayButtonClasses;
  /** The game runs or a stream target is selected: Steam's labels and Play stay. */
  steamLabels: boolean;
  /** Replaces Steam's play glyph. */
  icon: ReactNode;
  /** The second line under "Play", where Steam names the streaming PC. */
  shortName: string;
  /** Replaces Steam's first line (its "Resume" while Battle.net runs); absent keeps Steam's. */
  playText?: string;
  /** Our chevron, used when Steam renders none (one client). */
  chevron: ReactElement;
  /** Opens the "Play from…" menu: replaces the handler of Steam's chevron. */
  onChevron: (event: unknown) => void;
  /** Starts the selected client; absent keeps Steam's own Play. */
  onPlay?: (event: unknown) => void;
}

type Props = Record<string, unknown> & { className?: unknown; children?: unknown };
type Element = ReactElement<Props>;

function hasClass(node: unknown, name: string): node is Element {
  if (!isValidElement<Props>(node) || !name) return false;
  const classes = node.props.className;
  return typeof classes === "string" && classes.split(/\s+/).includes(name);
}

const withClass = (className: unknown, name: string) =>
  hasClass({ props: { className } }, name) ? className : `${String(className)} ${name}`;

/** Swap Steam's click handler, keeping whichever event Steam listens on (fake actions use mouse-up). */
function handlerProps(props: Props, handler: (event: unknown) => void) {
  return typeof props.onMouseUp === "function" ? { onMouseUp: handler } : { onClick: handler };
}

interface SteamEvent {
  stopPropagation(): void;
  preventDefault(): void;
}

/**
 * The event Steam's handlers expect. Steam's own handlers (its
 * `ShowStreamingMenu` among them) call `stopPropagation` and
 * `preventDefault`; a Focusable's `onActivate` and a test pass events
 * without them, so those get no-op stand-ins.
 */
export function steamEvent(event: unknown): SteamEvent {
  const e = event as Partial<Record<keyof SteamEvent, unknown>> | null;
  return typeof e?.stopPropagation === "function" && typeof e.preventDefault === "function"
    ? (event as SteamEvent)
    : { stopPropagation() {}, preventDefault() {} };
}

const isLabel = (node: unknown): node is Element =>
  isValidElement<Props>(node) && "showThrobber" in node.props && "text" in node.props;

/** Steam's chevron element: it carries the overview and a click handler, the explainer has `onDismiss`. */
const isSelector = (node: unknown): node is Element =>
  isValidElement<Props>(node) &&
  "overview" in node.props &&
  !("onDismiss" in node.props) &&
  (typeof node.props.onClick === "function" || typeof node.props.onMouseUp === "function");

const isExplainer = (node: unknown) => isValidElement<Props>(node) && "onDismiss" in node.props;

/**
 * Steam's Play button with WoWDeck's client choice: the chevron always
 * shows and opens our menu, and, unless Steam's own labels apply, the
 * selected target's icon and short name sit in the button the way Steam
 * shows a stream target, and Play starts it. Returns undefined when the
 * tree isn't shaped like the Play button observed on the Deck.
 */
export function patchPlayButton(tree: unknown, patch: PlayButtonPatch): Element | undefined {
  const { classes } = patch;
  if (!hasClass(tree, classes.container) || !Array.isArray(tree.props.children)) return undefined;
  const children = tree.props.children.slice() as unknown[];
  const playIndex = children.findIndex((child) => hasClass(child, classes.playButton));
  const play = children[playIndex] as Element | undefined;
  if (!play || !Array.isArray(play.props.children)) return undefined;
  const parts = play.props.children.slice() as unknown[];
  const labelIndex = parts.findIndex(isLabel);
  if (labelIndex < 0) return undefined;

  const selectorIndex = children.findIndex(isSelector);
  if (selectorIndex >= 0) {
    const selector = children[selectorIndex] as Element;
    children[selectorIndex] = cloneElement(selector, handlerProps(selector.props, patch.onChevron));
  } else {
    const at = children.findIndex(isExplainer);
    children.splice(at < 0 ? children.length : at, 0, patch.chevron);
  }

  if (!patch.steamLabels) {
    const label = parts[labelIndex] as Element;
    parts[labelIndex] = cloneElement(label, {
      remoteText: createElement(
        Fragment,
        null,
        patch.playText ?? (label.props.text as ReactNode),
        createElement(
          "div",
          { className: `${classes.buttonText} ${classes.buttonRemoteText}` },
          patch.shortName,
        ),
      ),
    });
    if (isValidElement(parts[labelIndex - 1])) parts[labelIndex - 1] = patch.icon;
    children[playIndex] = cloneElement(
      play,
      {
        className: withClass(play.props.className, classes.hasRemoteText),
        ...(patch.onPlay && handlerProps(play.props, patch.onPlay)),
      },
      ...(parts as ReactNode[]),
    );
  }

  return cloneElement(
    tree,
    { className: withClass(tree.props.className, classes.showingStreaming) },
    ...(children as ReactNode[]),
  ) as Element;
}

const isLocalRow = (node: unknown): node is ReactElement<{ client: { clientid: unknown } }> =>
  isValidElement<Props>(node) &&
  node.props.isLocalClient === true &&
  typeof node.props.client === "object" &&
  node.props.client !== null &&
  "clientid" in node.props.client;

/**
 * Steam's "Play from…" menu with its local row ("Play on this Steam Deck")
 * replaced by `rows`, given the local client's id. Every other row, such as
 * "Stream from <PC>", stays Steam's own element. Returns undefined when the
 * menu has no local row where the Deck's menu has it.
 */
export function replaceLocalPlayRow(
  menu: unknown,
  rows: (localClientId: unknown) => ReactNode[],
): Element | undefined {
  if (!isValidElement<Props>(menu) || !Array.isArray(menu.props.children)) return undefined;
  const children = menu.props.children.slice() as unknown[];
  for (const [index, group] of children.entries()) {
    if (!Array.isArray(group)) continue;
    const local = group.findIndex(isLocalRow);
    if (local < 0) continue;
    const row = group[local] as ReactElement<{ client: { clientid: unknown } }>;
    children[index] = [
      ...group.slice(0, local),
      ...rows(row.props.client.clientid),
      ...group.slice(local + 1),
    ];
    return cloneElement(menu, {}, ...(children as ReactNode[])) as Element;
  }
  return undefined;
}
