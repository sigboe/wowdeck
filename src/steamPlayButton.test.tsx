import { expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { patchPlayButton, replaceLocalPlayRow, type PlayButtonPatch } from "./steamPlayButton";

// Stand-ins for Steam's private pieces, shaped like the Deck's Play button
// render output (see docs/ui/device-notes.md §8.4e).
const Steam = {
  Container: (p: { className: string; children?: ReactNode }) => (
    <div className={p.className}>{p.children}</div>
  ),
  Button: (p: { className: string; children?: ReactNode; onClick?: () => void }) => (
    <button className={p.className} onClick={p.onClick}>
      {p.children}
    </button>
  ),
  PlayIcon: () => <svg data-icon="play" />,
  Label: (p: { text: string; remoteText?: ReactNode; showThrobber: boolean }) =>
    p.remoteText ? (
      <div className="RemotePlayTextContainer">
        <div className="ButtonText">{p.remoteText}</div>
      </div>
    ) : (
      <div className="ButtonText">{p.text}</div>
    ),
  Selector: (p: { overview: unknown; onClick?: () => void; onMouseUp?: () => void }) => (
    <button className="StreamingSelector" aria-label="Play from…" onClick={p.onClick} />
  ),
  Explainer: (_: { overview: unknown; active: boolean; onDismiss: () => void }) => null,
};

const steamPlay = () => {};
const steamMenu = () => {};

function steamTree({
  clients = 1,
  running = false,
  remoteText,
}: { clients?: number; running?: boolean; remoteText?: ReactNode } = {}) {
  const overview = { appid: 42 };
  return (
    <Steam.Container
      className={`PlayButtonContainer Green${clients > 1 ? " ShowingStreaming" : ""}`}
    >
      {[
        <Steam.Button
          key="play"
          className={`PlayButton ButtonChild${remoteText ? " HasRemoteText" : ""}`}
          onClick={steamPlay}
        >
          {[
            false,
            <Steam.PlayIcon key="icon" />,
            <Steam.Label
              key="label"
              text={running ? "Resume" : "Play"}
              remoteText={remoteText}
              showThrobber={false}
            />,
            false,
          ]}
        </Steam.Button>,
        running && <Steam.Button key="stop" className="ShutdownAppButton" />,
        clients > 1 && <Steam.Selector key="selector" overview={overview} onClick={steamMenu} />,
        <Steam.Explainer key="explainer" overview={overview} active={false} onDismiss={() => {}} />,
      ]}
    </Steam.Container>
  );
}

const ourMenu = () => {};
const ourPlay = () => {};
const patch = (over: Partial<PlayButtonPatch> = {}): PlayButtonPatch => ({
  classes: {
    container: "PlayButtonContainer",
    playButton: "PlayButton",
    hasRemoteText: "HasRemoteText",
    showingStreaming: "ShowingStreaming",
    buttonText: "ButtonText",
    buttonRemoteText: "ButtonRemoteText",
  },
  steamLabels: false,
  icon: <img data-icon="forever" />,
  shortName: "Forever",
  chevron: <button className="StreamingSelector" aria-label="Play from…" data-ours />,
  onChevron: ourMenu,
  onPlay: ourPlay,
  ...over,
});

const html = (tree: unknown) => renderToStaticMarkup(tree as ReactElement);

function propsOf(tree: unknown, className: string) {
  const stack: unknown[] = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node);
    else if (isValidElement<{ className?: string; children?: unknown }>(node)) {
      if (node.props.className?.split(" ").includes(className)) return node.props;
      stack.push(node.props.children);
    }
  }
  return undefined;
}

function selectorProps(tree: unknown) {
  const children = (tree as ReactElement<{ children: unknown[] }>).props.children;
  const selector = children.find(
    (child) => isValidElement(child) && child.type === Steam.Selector,
  ) as ReactElement<{ onClick?: unknown }> | undefined;
  return selector?.props;
}

test("a one-client page gets the chevron, the client's icon and its short name", () => {
  const patched = patchPlayButton(steamTree(), patch());
  const markup = html(patched);

  expect(markup).toContain('data-ours="true"');
  expect(propsOf(patched, "PlayButtonContainer")?.className).toContain("ShowingStreaming");
  expect(markup).toContain('data-icon="forever"');
  expect(markup).not.toContain('data-icon="play"');
  expect(markup).toContain(
    '<div class="RemotePlayTextContainer"><div class="ButtonText">Play<div class="ButtonText ButtonRemoteText">Forever</div></div></div>',
  );
  expect(propsOf(patched, "PlayButton")?.className).toContain("HasRemoteText");
  expect((propsOf(patched, "PlayButton") as { onClick?: unknown }).onClick).toBe(ourPlay);
});

test("a running game keeps Steam's Resume label, glyph and Play", () => {
  const patched = patchPlayButton(steamTree({ running: true }), patch({ steamLabels: true }));
  const markup = html(patched);

  expect(markup).toContain('<div class="ButtonText">Resume</div>');
  expect(markup).toContain('data-icon="play"');
  expect(markup).not.toContain("Forever");
  expect((propsOf(patched, "PlayButton") as { onClick?: unknown }).onClick).toBe(steamPlay);
  expect(markup).toContain('data-ours="true"');
});

test("Battle.net running with WoW not running: Play names the chosen client and starts it", () => {
  // Steam sees its entry (Battle.net) running and draws Resume and Stop.
  const patched = patchPlayButton(steamTree({ running: true }), patch({ playText: "Play" }));
  const markup = html(patched);

  expect(markup).not.toContain("Resume");
  expect(markup).toContain(
    '<div class="ButtonText">Play<div class="ButtonText ButtonRemoteText">Forever</div></div>',
  );
  expect(markup).toContain('data-icon="forever"');
  expect((propsOf(patched, "PlayButton") as { onClick?: unknown }).onClick).toBe(ourPlay);
  expect(propsOf(patched, "ShutdownAppButton")).toBeDefined();
});

test("a selected stream target keeps Steam's Stream label and its chevron opens our menu", () => {
  const stream = (
    <>
      Stream<div className="ButtonText ButtonRemoteText">Kaptan</div>
    </>
  );
  const patched = patchPlayButton(
    steamTree({ clients: 2, remoteText: stream }),
    patch({ steamLabels: true }),
  );
  const markup = html(patched);

  expect(markup).toContain("Stream");
  expect(markup).toContain("Kaptan");
  expect(markup).not.toContain("Forever");
  expect(markup).not.toContain("data-ours");
  expect(selectorProps(patched)?.onClick).toBe(ourMenu);
});

test("Battle.net keeps Steam's own Play while showing its icon and name", () => {
  const patched = patchPlayButton(
    steamTree(),
    patch({ shortName: "Battle.net", icon: <img data-icon="battlenet" />, onPlay: undefined }),
  );
  const markup = html(patched);

  expect(markup).toContain('data-icon="battlenet"');
  expect(markup).toContain('<div class="ButtonText ButtonRemoteText">Battle.net</div>');
  expect((propsOf(patched, "PlayButton") as { onClick?: unknown }).onClick).toBe(steamPlay);
});

test("a tree not shaped like Steam's Play button is left alone", () => {
  expect(patchPlayButton(<div className="PlayButtonContainer" />, patch())).toBeUndefined();
  expect(
    patchPlayButton(
      <div className="PlayButtonContainer">{[<button key="a" className="Other" />]}</div>,
      patch(),
    ),
  ).toBeUndefined();
  expect(patchPlayButton(null, patch())).toBeUndefined();
});

// Steam's "Play from…" menu: one row per per-client entry (shaped like the Deck's).
const SteamMenu = (p: { label: string; children?: ReactNode }) => (
  <div role="menu" aria-label={p.label}>
    {p.children}
  </div>
);
const SteamRow = (p: {
  client: { clientid: string; client_name: string };
  isLocalClient: boolean;
  selected: boolean;
  onSelected: () => void;
}) => (
  <div role="menuitem" aria-checked={p.selected}>
    {p.isLocalClient ? "Play on this Steam Deck" : `Stream from ${p.client.client_name}`}
  </div>
);

function steamMenuTree(remote: boolean) {
  const clients = [
    { clientid: "0", client_name: "steamdeck" },
    ...(remote ? [{ clientid: "77", client_name: "Kaptan" }] : []),
  ];
  return (
    <SteamMenu label="Play from…">
      {[
        clients.map((client, i) => (
          <SteamRow
            key={client.clientid}
            client={client}
            isLocalClient={i === 0}
            selected={i === 0}
            onSelected={() => {}}
          />
        )),
        false,
      ]}
    </SteamMenu>
  );
}

test("the menu's local row becomes our rows while a remote row stays Steam's", () => {
  const seen: unknown[] = [];
  const menu = steamMenuTree(true);
  const patched = replaceLocalPlayRow(menu, (localClientId) => {
    seen.push(localClientId);
    return [
      <div key="bnet" role="menuitem">
        Battle.net
      </div>,
      <div key="forever" role="menuitem">
        Forever
      </div>,
    ];
  });

  expect(seen).toEqual(["0"]);
  expect(html(patched)).toBe(
    '<div role="menu" aria-label="Play from…"><div role="menuitem">Battle.net</div><div role="menuitem">Forever</div><div role="menuitem" aria-checked="false">Stream from Kaptan</div></div>',
  );
  const rows = (menu.props.children as unknown[][])[0]!;
  const patchedRows = (patched as ReactElement<{ children: unknown[][] }>).props.children[0]!;
  expect(patchedRows[2]).toBe(rows[1]);
});

test("a menu without Steam's local row is left alone", () => {
  expect(replaceLocalPlayRow(<SteamMenu label="Play from…" />, () => [])).toBeUndefined();
  expect(replaceLocalPlayRow(undefined, () => [])).toBeUndefined();
});
