import { expect, mock, test, setSystemTime, beforeEach, spyOn } from "bun:test";
import type { ReactElement, ReactNode, Ref } from "react";
import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { fakeDeckyUi } from "./testing/fakeDeckyUi";
import { connectEngine } from "./engineLink";
import { createFakeEngine, engineFailure, settle } from "./testSupport/fakeEngine";
import { pickerStartPath } from "./pickerStart";
import type {
  TradeSkillMasterAccount,
  TradeSkillMasterDestination,
  TradeSkillMasterLedger,
} from "../backend/src/api/contracts";
import type { Addon } from "./types";

// The addon session TsmAddon now writes through pulls in the plugin toasts,
// which import Decky's API: not installed outside the Deck.
const toasts: { title: string; body: string }[] = [];
/** Each folder picker opened: its selection type and start folder. */
const pickers: { type: number; start: string }[] = [];
/** What the picker answers: a folder, or a rejection (cancelled). */
let pickFolder: (start: string) => Promise<{ path: string }> = async () => {
  throw new Error("cancel");
};
mock.module("@decky/api", () => ({
  toaster: {
    toast: (t: { title: string; body: string }) => toasts.push({ title: t.title, body: t.body }),
  },
  openFilePicker: async (type: number, start: string) => {
    pickers.push({ type, start });
    return pickFolder(start);
  },
  FileSelectionType: { FILE: 0, FOLDER: 1 },
}));

let updated: number | null = null;
let installed = true;
let modal: ReactElement<{ onOK(): void; strDescription: string }> | undefined;
const removals: unknown[] = [];
let removalFails = false;
let holdRemoval: Promise<void> | undefined;
let cleanupError: string | undefined;
const requests: string[] = [];
const followRequests: unknown[] = [];
const refreshRequests: unknown[] = [];
let followed = true;
let extraFollows = false;
let holdFollow: Promise<void> | undefined;
let failUnfollow = false;
let unlimited = false;
let holdAccount: Promise<void> | undefined;
let holdDestination: Promise<void> | undefined;
let holdAddons: Promise<void> | undefined;
let qamOpens = 0;
let cancelModal: (() => void) | undefined;
let modalRoot: ReturnType<typeof createRoot> | undefined;
let holdLedger: Promise<void> | undefined;
const ledgerRequests: unknown[] = [];
/** Export as the engine answers it: the folder it remembers, the exports asked for, a failure. */
let exportFolder: string | null = null;
const exportRequests: unknown[] = [];
let exportFails = false;
/** When set, the fake Ledger answers with the selection asked for, as the engine would. */
let echoFilters:
  | ((
      ledger: TradeSkillMasterLedger,
      params: {
        account?: string;
        realm?: string;
        character?: string;
        period?: TradeSkillMasterLedger["period"];
      },
    ) => TradeSkillMasterLedger)
  | undefined;
/** A Ledger with nothing to choose and nothing to count. */
const noFilters = {
  realms: [],
  realm: null,
  characters: [],
  character: null,
  period: "All",
  figures: null,
  itemCount: 0,
  exportable: false,
  gold: null,
} as const satisfies Partial<TradeSkillMasterLedger>;
let ledger: TradeSkillMasterLedger | Error = {
  state: "noRecords",
  accounts: ["MAIN"],
  account: "MAIN",
  recordedAt: null,
  gameRunning: false,
  retail: false,
  wowhead: "classic",
  ...noFilters,
};

/** What the fake account, destination and follow calls answer: one fixture for all. */
const accountFixture = (params: { installationId?: string }) => {
  requests.push(params.installationId ?? "");
  return {
    account: "Fixture",
    follows: followed
      ? [
          ...(extraFollows
            ? [
                {
                  realmId: 1,
                  name: "First realm",
                  region: "EU",
                  gameVersion: "Retail",
                  auctionHouseType: "ALL",
                },
              ]
            : []),
          {
            realmId: 99,
            name: "Remote realm",
            region: "US",
            gameVersion: "Classic Era",
            auctionHouseType: "HORDE",
          },
        ]
      : [],
    tier: "gold",
    followedCount: followed ? 7 : 6,
    allowance: unlimited ? null : 25,
    realms:
      params?.installationId === "empty"
        ? []
        : [
            {
              id: 1,
              name:
                params?.installationId === "inactive" ? "Other installation" : "Der Abyssische Rat",
              auctionHouseType: params?.installationId === "inactive" ? "HORDE" : "ALL",
              followed,
              owned: false,
              declined: false,
              updated,
            },
          ],
    regions: params?.installationId === "empty" ? [] : [{ id: 2, name: "EU", updated }],
  };
};
const fake = createFakeEngine({
  "tradeskillmaster.account": async () => {
    await holdAccount;
    return accountFixture({}) as unknown as TradeSkillMasterAccount;
  },
  "tradeskillmaster.ledger": async (params) => {
    ledgerRequests.push(params);
    await holdLedger;
    if (ledger instanceof Error) throw ledger;
    return echoFilters ? echoFilters(ledger, params) : ledger;
  },
  "tradeskillmaster.ledgerItems": { rows: [], nextOffset: null },
  "tradeskillmaster.ledgerExportFolder": () => ({ folder: exportFolder ?? "/home/deck/Documents" }),
  "tradeskillmaster.ledgerExport": (params) => {
    exportRequests.push(params);
    if (exportFails)
      return engineFailure("internal_error", "No permission to write to that folder");
    exportFolder = params.folder;
    return { path: `${params.folder}/TSM_${params.realm ?? "2_Realms"}_2026-11-24.zip` };
  },
  "tradeskillmaster.destination": async (params) => {
    await holdDestination;
    return accountFixture(params) as unknown as TradeSkillMasterDestination;
  },
  "addons.list": async () => {
    await holdAddons;
    return {
      addons: installed
        ? [
            {
              folderName: "TradeSkillMaster_AppHelper",
              providerId: "TradeSkillMaster",
              externalId: "TradeSkillMaster",
              version: "4.14",
              channel: "stable",
            },
          ]
        : [],
    } as { addons: Addon[] };
  },
  "tradeskillmaster.cleanupPreview": () => [
    {
      realmId: 1,
      name: "Cleanup realm",
      region: "EU",
      gameVersion: "Retail",
      auctionHouseType: "ALL",
    },
  ],
  "tradeskillmaster.removeAddons": async (params) => {
    removals.push(params);
    await holdRemoval;
    if (!removalFails) installed = false;
    return {
      operations: [{ status: removalFails ? "failed" : "removed" }],
      cleanup: (params as { cleanupFollows?: boolean })?.cleanupFollows
        ? {
            error: cleanupError,
            removed: [],
            leftBehind: [
              {
                realmId: 1,
                name: "Cleanup realm",
                region: "EU",
                gameVersion: "Retail",
                auctionHouseType: "ALL",
              },
            ],
          }
        : undefined,
    } as never;
  },
  "tradeskillmaster.refresh": (params) => {
    refreshRequests.push(params);
  },
  "tradeskillmaster.unfollow": (params) => {
    followRequests.push(params);
    if (failUnfollow) throw new Error("fixture failure");
    followed = false;
    return accountFixture({}) as unknown as TradeSkillMasterAccount;
  },
  "tradeskillmaster.setFollow": async (params) => {
    followRequests.push(params);
    await holdFollow;
    followed = !followed;
    return accountFixture(params) as unknown as TradeSkillMasterDestination;
  },
});
connectEngine(fake);

/**
 * Steam's Focusable as far as these tests need it: a node with an action
 * takes focus, and a button press (`press`) reaches the focused node's
 * `onButtonDown` first, then each enclosing one's, until one stops it.
 */
function SteamFocusable({
  children,
  ref,
  className,
  onActivate,
  onButtonDown,
}: {
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
  className?: string;
  onActivate?: () => void;
  onButtonDown?: (evt: unknown) => void;
}) {
  const own = useRef<HTMLDivElement | null>(null);
  const handler = useRef(onButtonDown);
  handler.current = onButtonDown;
  useEffect(() => {
    const el = own.current;
    const listen = (e: Event) =>
      handler.current?.({
        detail: (e as CustomEvent).detail,
        preventDefault: () => e.preventDefault(),
        stopPropagation: () => e.stopPropagation(),
      });
    el?.addEventListener("gamepadbutton", listen);
    return () => el?.removeEventListener("gamepadbutton", listen);
  }, []);
  return (
    <div
      ref={(el) => {
        own.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      className={onActivate ? ["Focusable", className].filter(Boolean).join(" ") : className}
      tabIndex={onActivate ? -1 : undefined}
    >
      {children}
    </div>
  );
}
/** Pages opened in Steam's browser (Navigation.NavigateToExternalWeb). */
const webPages: string[] = [];

/**
 * A focusable Field's node: the focus target, with its A and trigger
 * descriptions as data attributes for the footer checks.
 */
function FocusField({
  children,
  ref,
  onGamepadFocus,
  onButtonDown,
  onOKActionDescription,
  actionDescriptionMap,
}: {
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
  onGamepadFocus?: () => void;
  onButtonDown?: (evt: unknown) => void;
  onOKActionDescription?: string;
  actionDescriptionMap?: Record<number, string>;
}) {
  const own = useRef<HTMLDivElement | null>(null);
  const handler = useRef(onButtonDown);
  handler.current = onButtonDown;
  useEffect(() => {
    const el = own.current;
    const listen = (e: Event) =>
      handler.current?.({
        detail: (e as CustomEvent).detail,
        preventDefault: () => e.preventDefault(),
        stopPropagation: () => e.stopPropagation(),
      });
    el?.addEventListener("gamepadbutton", listen);
    return () => el?.removeEventListener("gamepadbutton", listen);
  }, []);
  return (
    <div
      className="Focusable"
      tabIndex={-1}
      data-ok={onOKActionDescription}
      data-l2={actionDescriptionMap?.[7]}
      data-r2={actionDescriptionMap?.[8]}
      ref={(el) => {
        own.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      onFocus={onGamepadFocus}
    >
      {children}
    </div>
  );
}
const notify = (event: { event: "tradeskillmaster.changed" }) =>
  fake.emit({ ...event, params: {} });
mock.module("@decky/ui", () => ({
  ...fakeDeckyUi,
  Navigation: {
    OpenQuickAccessMenu: () => {
      qamOpens++;
    },
    NavigateToExternalWeb: (url: string) => webPages.push(url),
  },
  QuickAccessTab: { Decky: 3 },
  GamepadButton: { TRIGGER_LEFT: 7, TRIGGER_RIGHT: 8, DIR_LEFT: 13, DIR_RIGHT: 14 },
  Focusable: SteamFocusable,
  // A focusable Field is itself the focus target: its ref, Steam's
  // onGamepadFocus when it takes focus, and its own button presses.
  Field: (
    p: Parameters<typeof fakeDeckyUi.Field>[0] & {
      focusable?: boolean;
      ref?: Ref<HTMLDivElement>;
      onGamepadFocus?: () => void;
      onButtonDown?: (evt: unknown) => void;
      onOKActionDescription?: string;
      actionDescriptionMap?: Record<number, string>;
    },
  ) =>
    p.focusable ? <FocusField {...p}>{fakeDeckyUi.Field(p)}</FocusField> : fakeDeckyUi.Field(p),
  // Steam's gamepad navigation still stops on a disabled DialogButton (the
  // Ledger's disabled Export, DEVICE 2026-11-24) unless it is
  // `focusable={false}`: the Focusable class marks a gamepad stop, tabindex
  // what the browser can focus.
  DialogButton: (p: Parameters<typeof fakeDeckyUi.DialogButton>[0] & { focusable?: boolean }) => (
    <div
      className={p.focusable === false ? undefined : "Focusable"}
      tabIndex={p.disabled || p.focusable === false ? undefined : -1}
    >
      {fakeDeckyUi.DialogButton(p)}
    </div>
  ),
  // Steam's disabled button is no focus stop.
  ButtonItem: (p: Parameters<typeof fakeDeckyUi.ButtonItem>[0]) => (
    <div className="Focusable" tabIndex={p.disabled ? undefined : -1}>
      {fakeDeckyUi.ButtonItem(p)}
    </div>
  ),
  // Steam's dialog takes focus as it opens: its first focus stop, unless
  // something inside already took it. Its `className` lands on the dialog box.
  ModalRoot: function ModalRoot({
    children,
    onCancel,
    className,
  }: {
    children?: import("react").ReactNode;
    onCancel(): void;
    className?: string;
  }) {
    cancelModal = onCancel;
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const el = root.current;
      if (el && !el.contains(document.activeElement)) {
        el.querySelector<HTMLElement>(".Focusable[tabindex]")?.focus();
      }
    }, []);
    return (
      <div ref={root} className={className} data-modal-root="">
        {children}
      </div>
    );
  },
  ConfirmModal: (p: {
    children?: import("react").ReactNode;
    onOK(): void;
    closeModal?: () => void;
  }) => {
    cancelModal = p.closeModal;
    return (
      <div>
        {p.children}
        <button onClick={p.onOK}>Uninstall both</button>
        <button onClick={p.closeModal}>Cancel</button>
      </div>
    );
  },
  ToggleField: (p: {
    label: string;
    checked: boolean;
    disabled: boolean;
    onChange(v: boolean): void;
  }) => (
    <label>
      {p.label}
      <input
        type="checkbox"
        checked={p.checked}
        disabled={p.disabled}
        onChange={(e) => p.onChange(e.target.checked)}
      />
    </label>
  ),
  showModal: (
    element: NonNullable<typeof modal>,
    _parent: unknown,
    options?: { fnOnClose?: () => void },
  ) => {
    modalRoot?.unmount();
    modal = element;
    const node = document.createElement("div");
    document.body.append(node);
    modalRoot = createRoot(node);
    const close = () => {
      modalRoot?.unmount();
      modalRoot = undefined;
      node.remove();
      options?.fnOnClose?.();
    };
    modalRoot.render(<element.type {...element.props} closeModal={close} />);
    return { Close: close };
  },
}));
const { rememberedFocus, resetFocusMemory, restoreFocus } = await import("./focusMemory");
const { browseFocusView, browseZone } = await import("./browseSessionState");
const { TsmAddon } = await import("./components/TsmAddon");
const { resetTsmReads, putTsmAccount } = await import("./tsmReads");
const { TsmDestination, firstTsmControl, focusTsmEntry } =
  await import("./components/TsmDestination");
const { resetTsmView, tsmView } = await import("./tsmView");
const { LEDGER_FOCUS, LEDGER_LEFT_NEIGHBOUR } = await import("./components/TsmLedger");
const { resetLedgerFilters } = await import("./tsmLedgerFilters");
const { resetLedgerExport } = await import("./tsmLedgerExport");
const { Focusable, GamepadButton } = await import("@decky/ui");

/** The Ledger's Export row's button: the row labelled "Export ledger". */
const exportRowButton = (container: HTMLElement) =>
  [...container.querySelectorAll("b")]
    .find((label) => label.textContent === "Export ledger")!
    .parentElement!.querySelector<HTMLButtonElement>("button")!;

beforeEach(resetTsmReads);

test("destination shows account allowance, waiting data and live freshness for the selected installation", async () => {
  setSystemTime(new Date("2026-11-10T12:00:00Z"));
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = dom.window.document.getElementById("root")!;
  let root = createRoot(container);
  try {
    await act(async () => root.render(<TsmAddon installationId="active" />));
    expect(container.textContent).not.toContain("gold");
    expect(container.textContent).toContain("Signed in as Fixture");
    // The title row names the destination; the page repeats no heading.
    expect(container.querySelector("h2")).toBeNull();
    expect(container.textContent).toContain("Der Abyssische Rat: Followed");

    expect(container.textContent).toContain("7 of 25 realms followed");
    expect(container.textContent).toContain("Der Abyssische Rat");
    expect(container.textContent).toContain("No auction data yet");
    // Version and channel live in My Addons, not on this page.
    expect(container.textContent).not.toContain("4.14");
    expect(container.textContent).not.toContain("stable");
    await act(async () =>
      (
        Array.from(container.querySelectorAll("button")).find((b) =>
          b.textContent?.startsWith("Refresh auction data"),
        ) as HTMLButtonElement
      ).click(),
    );
    expect(refreshRequests).toEqual([{ installationId: "active" }]);
    // The button says it is working until the engine reports new data.
    const refreshButton = () =>
      Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Refresh"),
      ) as HTMLButtonElement;
    expect(refreshButton().textContent).toContain("Refreshing…");
    expect(refreshButton().disabled).toBe(true);
    updated = Math.floor(Date.now() / 1000) - 180;
    await act(async () => notify({ event: "tradeskillmaster.changed" }));
    expect(refreshButton().textContent).toContain("Refresh auction data");
    expect(container.textContent).toContain("Updated 3 minutes ago");
    expect(container.textContent).toContain("EU region data");
    // Already-followed realms are managed through Manage. Exercise a new local follow
    // while keeping the grouped addon actions available during the request.
    followed = false;
    await act(async () => notify({ event: "tradeskillmaster.changed" }));
    expect(container.textContent).toContain("Not followed");
    let finishFollow!: () => void;
    holdFollow = new Promise<void>((resolve) => {
      finishFollow = resolve;
    });
    await act(async () =>
      (
        Array.from(container.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("Der Abyssische Rat"),
        ) as HTMLButtonElement
      ).click(),
    );
    expect(followRequests).toEqual([
      { installationId: "active", realmId: 1, auctionHouseType: "ALL", followed: true },
    ]);
    const uninstall = () =>
      Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.startsWith("Uninstall"),
      )!;
    expect(uninstall()).toBeDefined();
    // Side by side in one row: each button in its focus slot, both slots in the grid.
    expect(uninstall().parentElement?.parentElement?.parentElement).toBe(
      refreshButton().parentElement?.parentElement?.parentElement,
    );
    await act(async () => uninstall().click());
    expect(modal!.props.strDescription).toContain("TradeSkillMaster and AppHelper");
    expect(removals).toEqual([]); // Dismissing the modal makes no request.
    expect(document.body.textContent).toContain("Cleanup realm");
    expect(document.body.textContent).toContain("EU · Retail");
    expect((document.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(
      false,
    );
    await act(async () => modalRoot?.unmount()); // Cancel before confirming.
    expect(removals).toEqual([]);
    await act(async () => uninstall().click());
    removalFails = true;
    await act(async () => root.unmount());
    await act(async () => modal!.props.onOK());
    root = createRoot(container);
    await act(async () => root.render(<TsmAddon installationId="active" />));
    expect(container.textContent).toContain("Couldn't uninstall");
    expect(uninstall()).toBeDefined();
    removalFails = false;
    await act(async () => modalRoot?.unmount());
    await act(async () => uninstall().click());
    await act(async () =>
      (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
    );
    await act(async () => root.unmount());
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent === "Uninstall both")!
        .click(),
    );
    root = createRoot(container);
    await act(async () => root.render(<TsmAddon installationId="active" />));
    expect(container.textContent).toContain("Account follows left behind: Cleanup realm");
    await act(async () => {
      finishFollow();
    });
    holdFollow = undefined;
    expect(removals).toEqual([
      { installationId: "active" },
      {
        installationId: "active",
        cleanupFollows: true,
        cleanupPreview: [
          {
            realmId: 1,
            name: "Cleanup realm",
            region: "EU",
            gameVersion: "Retail",
            auctionHouseType: "ALL",
          },
        ],
      },
    ]);
    expect(container.textContent).toContain("Install TradeSkillMaster");
    installed = false;
    await act(async () => root.render(<TsmAddon installationId="inactive" />));
    expect(requests[requests.length - 1]).toBe("inactive");
    expect(container.textContent).toContain("Install TradeSkillMaster");

    await act(async () => finishFollow());
    holdFollow = undefined;
    expect(container.textContent).toContain("Other installation");
    expect(container.textContent).toContain("Other installation · Horde");
    expect(container.textContent).not.toContain("Der Abyssische Rat");
    await act(async () => root.render(<TsmAddon installationId="empty" />));
    expect(container.textContent).not.toContain("Other installation");
    expect(container.textContent).not.toContain("EU region data");
    expect(container.textContent).toContain("No saved character evidence");
    expect(container.textContent).toContain("create a character");
    expect(container.textContent).toContain("log out");
    expect(container.textContent).toContain("TradeSkillMaster and AppHelper");
    expect(container.textContent).toContain("6 of 25 realms followed");
    expect(
      [...container.querySelectorAll("button")].some((b) => b.textContent?.includes("Manage")),
    ).toBe(true);
    await act(async () => root.render(<TsmAddon installationId="active" />));
    expect(container.textContent).toContain("Der Abyssische Rat");
    expect(container.textContent).not.toContain("No saved character evidence");
  } finally {
    await act(async () => {
      modalRoot?.unmount();
      modalRoot = undefined;
      root.unmount();
    });
    dom.window.close();
    setSystemTime();
  }
});

test("Manage confirms remote follows, cancels without mutation, preserves failures, and updates unlimited counts", async () => {
  setSystemTime(new Date("2026-11-10T12:00:00Z"));
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(document.getElementById("root")!);
  followed = true;
  unlimited = true;
  followRequests.length = 0;
  const click = async (text: string) =>
    act(async () => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => !b.disabled && b.textContent?.includes(text),
      );
      expect(button).toBeDefined();
      button!.click();
    });
  try {
    await act(async () => root.render(<TsmAddon installationId="empty" />));
    expect(document.body.textContent).toContain("7 realms followed");
    expect(document.body.textContent).not.toContain("unlimited");
    await click("Manage");
    expect(document.body.textContent).toContain("Remote realm · Horde");
    expect(document.body.textContent).toContain("US · Classic Era");
    await click("Unfollow");
    expect(document.body.textContent).toContain("every computer");
    await click("Cancel");
    expect(followRequests).toEqual([]);
    await click("Unfollow");
    const opensBeforeCancel = qamOpens;
    await act(async () => cancelModal!());
    expect(document.body.textContent).toContain("Manage followed realms");
    expect(document.body.textContent).not.toContain("every computer");
    expect(qamOpens).toBe(opensBeforeCancel);
    expect(followRequests).toEqual([]);
    await click("Unfollow");
    failUnfollow = true;
    await click("Unfollow");
    expect(document.body.textContent).toContain("Couldn't unfollow");
    expect(document.body.textContent).toContain("7 realms followed");
    failUnfollow = false;
    await click("Unfollow");
    expect(document.body.textContent).toContain("6 realms followed");
    expect(document.body.textContent).not.toContain("Remote realm");
    expect(followRequests).toEqual([
      { realmId: 99, auctionHouseType: "HORDE" },
      { realmId: 99, auctionHouseType: "HORDE" },
    ]);
    await click("Done");
  } finally {
    await act(async () => {
      modalRoot?.unmount();
      modalRoot = undefined;
      root.unmount();
    });
    dom.window.close();
    setSystemTime();
  }
});

for (const outcome of ["success", "failure", "cleanup unavailable"]) {
  test("uninstall survives panel remount during " + outcome, async () => {
    const dom = new JSDOM('<div id="root"></div>');
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    const container = document.getElementById("root")!;
    let root = createRoot(container);
    let finish!: () => void;
    installed = true;
    removalFails = outcome === "failure";
    cleanupError =
      outcome === "cleanup unavailable" ? "Couldn't check account follows." : undefined;
    holdRemoval = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const id = "remount-" + outcome;
    try {
      await act(async () => root.render(<TsmAddon installationId={id} />));
      await act(async () =>
        [...container.querySelectorAll("button")]
          .find((b) => b.textContent === "Uninstall")!
          .click(),
      );
      await act(async () => root.unmount());
      if (cleanupError) {
        await act(async () =>
          (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
        );
      }
      await act(async () =>
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent === "Uninstall both")!
          .click(),
      );
      root = createRoot(container);
      await act(async () => root.render(<TsmAddon installationId={id} />));
      expect(container.textContent).toContain("Working…");
      await act(async () => finish());
      expect(container.textContent).not.toContain("Working…");
      if (removalFails) expect(container.textContent).toContain("Couldn't uninstall completely");
      else expect(container.textContent).toContain("Install TradeSkillMaster");
      if (cleanupError) {
        expect(container.textContent).toContain(
          "Addons removed. Couldn't clean up account follows.",
        );
        expect(container.textContent).toContain(
          "Account follows left behind: Cleanup realm · EU · Retail",
        );
      }
    } finally {
      finish();
      holdRemoval = undefined;
      cleanupError = undefined;
      removalFails = false;
      await act(async () => {
        root.unmount();
        modalRoot?.unmount();
      });
      modalRoot = undefined;
      dom.window.close();
    }
  });
}

for (const dismissal of ["B", "Done"]) {
  test(`Manage returns to its control after ${dismissal}, panel remount and delayed account load`, async () => {
    const dom = new JSDOM('<div id="root"></div>');
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    resetFocusMemory();
    qamOpens = 0;
    const container = document.getElementById("root")!;
    let root = createRoot(container);
    let finish!: () => void;
    try {
      await act(async () => root.render(<TsmAddon installationId="empty" />));
      await act(async () =>
        [...container.querySelectorAll("button")]
          .find((b) => b.textContent?.includes("Manage"))!
          .click(),
      );
      await act(async () => root.unmount());
      await act(async () => {
        if (dismissal === "B") cancelModal!();
        else
          [...document.querySelectorAll("button")].find((b) => b.textContent === "Done")!.click();
      });
      expect(qamOpens).toBe(1);
      resetTsmReads(); // the remount's account read is a first load
      holdAccount = new Promise<void>((resolve) => {
        finish = resolve;
      });
      root = createRoot(container);
      await act(async () => root.render(<TsmAddon installationId="empty" />));
      expect(container.textContent).not.toContain("Manage");
      await act(async () => finish());
      expect(document.activeElement?.textContent).toContain("Manage");
    } finally {
      holdAccount = undefined;
      await act(async () => {
        root.unmount();
        modalRoot?.unmount();
      });
      modalRoot = undefined;
      dom.window.close();
    }
  });
}

test("Manage restores the selected last or different follow after repeated Cancel and B transitions", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  resetFocusMemory();
  extraFollows = true;
  followed = true;
  const root = createRoot(document.getElementById("root")!);
  const click = async (text: string) =>
    act(async () => {
      [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!.click();
    });
  try {
    await act(async () => root.render(<TsmAddon installationId="focus" />));
    await click("Manage");
    for (const index of [1, 0, 1, 0]) {
      await act(async () => {
        const rows = [...document.querySelectorAll("button")].filter(
          (b) =>
            b.querySelector("span") &&
            (b.textContent?.includes("First realm") || b.textContent?.includes("Remote realm")),
        );
        rows[index]!.click();
      });
      const confirmationGroup = [...document.querySelectorAll("h2")].find(
        (h) => h.textContent === "Unfollow realm?",
      )?.nextElementSibling?.firstElementChild;
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement?.textContent).toBe("Cancel");
      if (index === 1) await act(async () => cancelModal!());
      else await click("Cancel");
      expect(confirmationGroup?.isConnected).toBe(false);
      expect(document.activeElement?.textContent).toContain("Unfollow");
      expect(document.activeElement?.parentElement?.textContent).toContain(
        index === 1 ? "Remote realm" : "First realm",
      );
    }
  } finally {
    extraFollows = false;
    await act(async () => {
      modalRoot?.unmount();
      modalRoot = undefined;
      root.unmount();
    });
    dom.window.close();
  }
});

test("Unfollow moves focus to the neighbouring follow", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  resetFocusMemory();
  extraFollows = true;
  followed = true;
  const unfollow = fake.answers["tradeskillmaster.unfollow"];
  const full = accountFixture({}) as unknown as TradeSkillMasterAccount;
  let follows = full.follows;
  fake.answers["tradeskillmaster.unfollow"] = (params: { realmId: number }) => {
    follows = follows.filter((f) => f.realmId !== params.realmId);
    return { ...full, followedCount: follows.length, follows };
  };
  const root = createRoot(document.getElementById("root")!);
  const click = async (text: string) =>
    act(async () => {
      [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!.click();
    });
  /** The follow row holding focus (its button or its focus slot), or null. */
  const focusedRow = () => {
    const focused = document.activeElement;
    if (!focused || focused === document.body) return null;
    const rows = focused.tagName === "BUTTON" ? [focused] : [...focused.querySelectorAll("button")];
    return rows.length === 1 && rows[0]!.querySelector("span") ? rows[0]!.textContent : null;
  };
  const unfollowRow = async (name: string) => {
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((b) => b.querySelector("span") && b.textContent?.includes(name))!
        .click();
    });
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent === "Unfollow" && !b.querySelector("span"))!
        .click();
    });
  };
  try {
    await act(async () => root.render(<TsmAddon installationId="focus" />));
    await click("Manage");
    follows = [...follows, { ...follows[0]!, realmId: 7, name: "Last realm" }];
    putTsmAccount({ ...full, follows });
    // The first row goes: focus moves down to the row after it.
    await unfollowRow("First realm");
    expect(document.body.textContent).not.toContain("First realm");
    expect(focusedRow()).toContain("Remote realm");
    // The last row goes: focus moves up to the row before it.
    await unfollowRow("Last realm");
    expect(document.body.textContent).not.toContain("Last realm");
    expect(focusedRow()).toContain("Remote realm");
  } finally {
    extraFollows = false;
    fake.answers["tradeskillmaster.unfollow"] = unfollow;
    await act(async () => {
      modalRoot?.unmount();
      modalRoot = undefined;
      root.unmount();
    });
    dom.window.close();
  }
});

test("Uninstall returns by identity after modal close and delayed destination remount", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  resetFocusMemory();
  installed = true;
  const container = document.getElementById("root")!;
  let root = createRoot(container);
  try {
    for (let repeat = 0; repeat < 2; repeat++) {
      await act(async () => root.render(<TsmAddon installationId="cancel-uninstall" />));
      await act(async () =>
        [...container.querySelectorAll("button")]
          .find((b) => b.textContent === "Uninstall")!
          .click(),
      );
      await act(async () => root.unmount());
      const opens = qamOpens;
      await act(async () => {
        if (repeat === 0)
          [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!.click();
        else cancelModal!();
      });
      expect(qamOpens).toBe(opens + 1);
      let releaseAddons!: () => void;
      holdAddons = new Promise<void>((resolve) => {
        releaseAddons = resolve;
      });
      root = createRoot(container);
      await act(async () => root.render(<TsmAddon installationId="cancel-uninstall" />));
      await act(async () => releaseAddons());
      holdAddons = undefined;
      expect(document.activeElement === document.body).toBe(false);
      expect(document.activeElement?.textContent).toBe("Uninstall");
    }
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test("pending removal stays visible without auction data and belongs only to its installation", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  resetFocusMemory();
  installed = true;
  removalFails = false;
  let finish!: () => void;
  holdRemoval = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const container = document.getElementById("root")!;
  let root = createRoot(container);
  try {
    await act(async () => root.render(<TsmAddon installationId="pending-source" />));
    await act(async () =>
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Uninstall")!.click(),
    );
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent === "Uninstall both")!
        .click(),
    );
    await act(async () => root.unmount());
    let releaseData!: () => void;
    holdDestination = new Promise<void>((resolve) => {
      releaseData = resolve;
    });
    root = createRoot(container);
    await act(async () => root.render(<TsmAddon installationId="pending-source" />));
    expect(container.textContent).toContain("Working…");
    await act(async () => root.render(<TsmAddon installationId="other-installation" />));
    expect(container.textContent).not.toContain("Working…");
    await act(async () => root.render(<TsmAddon installationId="pending-source" />));
    expect(container.textContent).toContain("Working…");
    await act(async () => {
      finish();
      releaseData();
    });
  } finally {
    holdRemoval = undefined;
    holdDestination = undefined;
    await act(async () => {
      finish();
      root.unmount();
      modalRoot?.unmount();
      modalRoot = undefined;
    });
    dom.window.close();
  }
});

test("Manage shows a failed account refresh beside retained follows and can retry", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(document.getElementById("root")!);
  const answer = fake.answers["tradeskillmaster.account"];
  followed = true;
  holdAccount = undefined;
  const click = async (text: string) =>
    act(async () => {
      const button = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(text),
      );
      expect(button).toBeDefined();
      button!.click();
    });
  try {
    await act(async () => root.render(<TsmAddon installationId="empty" />));
    await act(async () => root.render(<></>));
    // Opening the panel again revalidates the account it read before; that read fails.
    fake.answers["tradeskillmaster.account"] = new Error("offline");
    await act(async () => root.render(<TsmAddon installationId="empty" />));
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("Manage"))!
        .click();
      root.unmount(); // Steam destroys the QAM opener when the modal opens.
    });
    expect(document.body.textContent).toContain("Couldn't load followed realms");
    expect(document.body.textContent).toContain("Remote realm");
    fake.answers["tradeskillmaster.account"] = answer;
    await click("Retry");
    expect(document.body.textContent).not.toContain("Couldn't load followed realms");
    expect(document.body.textContent).toContain("Remote realm");
  } finally {
    fake.answers["tradeskillmaster.account"] = answer;
    await act(async () => {
      modalRoot?.unmount();
      modalRoot = undefined;
      root.unmount();
    });
    dom.window.close();
  }
});

/**
 * The destination in its pane, as GetAddonsTab mounts it: the pane's own
 * button handler around it records what reaches it (Left there returns to
 * the destination list).
 */
async function mountDestination(signedIn = true) {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = dom.window.document.getElementById("root")!;
  // The widened pane's slot, which scrolls itself (GetAddonsTab).
  container.className = "wowdeck-pane-slot wowdeck-pane-slot-open";
  const root = createRoot(container);
  const reachedPane: number[] = [];
  const signIns: number[] = [];
  const render = (on = signedIn) =>
    act(async () =>
      root.render(
        <Focusable
          onButtonDown={(evt: { detail: { button: number } }) =>
            reachedPane.push(evt.detail.button)
          }
        >
          <TsmDestination installationId="active" signedIn={on} onSignIn={() => signIns.push(1)} />
        </Focusable>,
      ),
    );
  await render();
  /** A D-pad press on the focused node; Steam then gives its refocus a turn (G7). */
  const press = async (button: number) => {
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new dom.window.CustomEvent("gamepadbutton", {
          bubbles: true,
          cancelable: true,
          detail: { button },
        }),
      );
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  };
  const selected = () => container.querySelector(".wowdeck-tab-selected") as HTMLElement | null;
  const close = async () => {
    await act(async () => root.unmount());
    dom.window.close();
  };
  /** Leave the destination, so the next render reads it afresh. */
  const leave = () => act(async () => root.render(<></>));
  return { container, render, leave, press, selected, reachedPane, signIns, close };
}

test("the pill bar switches views with Left and Right, stops at the last pill and hands Left on the first to the list", async () => {
  resetTsmView();
  resetFocusMemory();
  const { container, press, selected, reachedPane, close } = await mountDestination();
  try {
    // One focus stop: only the selected pill takes focus.
    expect(container.querySelectorAll(".wowdeck-pill-bar .Focusable")).toHaveLength(1);
    expect(selected()?.textContent).toBe("Auction data");
    await act(async () => selected()!.focus());
    await press(GamepadButton.DIR_RIGHT);
    expect(selected()?.textContent).toBe("Ledger");
    expect(document.activeElement).toBe(selected());
    expect(container.textContent).toContain("Export");
    expect(container.textContent).not.toContain("Signed in as Fixture");
    // Right on the last pill goes nowhere, and the pane never sees it.
    await press(GamepadButton.DIR_RIGHT);
    expect(selected()?.textContent).toBe("Ledger");
    await press(GamepadButton.DIR_LEFT);
    expect(selected()?.textContent).toBe("Auction data");
    expect(document.activeElement).toBe(selected());
    expect(reachedPane).toEqual([]);
    // Left on the first pill is the pane's: back to the destination list.
    await press(GamepadButton.DIR_LEFT);
    expect(selected()?.textContent).toBe("Auction data");
    expect(reachedPane).toEqual([GamepadButton.DIR_LEFT]);
  } finally {
    await close();
  }
});

test("Auction data opens first, entry lands on the first content row, and the last view is kept for the session", async () => {
  resetTsmView();
  resetFocusMemory();
  let view = await mountDestination();
  try {
    expect(view.selected()?.textContent).toBe("Auction data");
    // Today's pane, unchanged, under the bar.
    expect(view.container.textContent).toContain("Signed in as Fixture");
    expect(view.container.textContent).toContain("Der Abyssische Rat");
    expect(firstTsmControl(view.container)?.textContent).toContain("Manage");
    await act(async () =>
      (
        [...view.container.querySelectorAll(".wowdeck-pill-bar .wowdeck-tab")].find(
          (p) => p.textContent === "Ledger",
        ) as HTMLElement
      ).click(),
    );
    expect(view.selected()?.textContent).toBe("Ledger");
    await view.close();
    // Leaving and coming back (a remount) keeps the Ledger.
    view = await mountDestination();
    expect(view.selected()?.textContent).toBe("Ledger");
    expect(firstTsmControl(view.container)?.textContent).toContain("No sales, purchases or gold");
  } finally {
    await view.close();
  }
});

test("signed out, Auction data offers sign-in and the Ledger still reads the records", async () => {
  resetTsmView();
  const { container, selected, signIns, close } = await mountDestination(false);
  try {
    expect(container.textContent).not.toContain("Signed in as");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Sign in in Options")!
        .click(),
    );
    expect(signIns).toEqual([1]);
    await act(async () =>
      (
        [...container.querySelectorAll(".wowdeck-tab")].find(
          (p) => p.textContent === "Ledger",
        ) as HTMLElement
      ).click(),
    );
    expect(selected()?.textContent).toBe("Ledger");
    expect(container.textContent).toContain("No sales, purchases or gold recorded yet");
  } finally {
    await close();
  }
});

test("the Ledger shows its freshness, the game-running line, each empty state and Export only with records", async () => {
  setSystemTime(new Date("2026-11-24T12:00:00Z"));
  resetTsmView();
  const base: TradeSkillMasterLedger = {
    state: "noRecords",
    accounts: ["MAIN"],
    account: "MAIN",
    recordedAt: Date.now() - 2 * 3_600_000,
    gameRunning: false,
    retail: false,
    wowhead: "classic",
    ...noFilters,
  };
  ledger = base;
  const view = await mountDestination();
  const showLedger = async () => {
    await view.leave();
    resetTsmReads();
    await view.render();
  };
  try {
    await act(async () =>
      (
        [...view.container.querySelectorAll(".wowdeck-tab")].find(
          (p) => p.textContent === "Ledger",
        ) as HTMLElement
      ).click(),
    );
    const text = () => view.container.textContent ?? "";
    expect(text()).toContain("Recorded at last logout · 2 hours ago");
    expect(text()).not.toContain("/reload to include this session");
    expect(text()).toContain("No sales, purchases or gold recorded yet");
    // Nothing to export: Export's row says so and its button is disabled.
    const exportButton = () => exportRowButton(view.container);
    expect(exportButton().disabled).toBe(true);
    expect(exportButton().textContent).toBe("Export");
    expect(text()).toContain("Nothing to export yet");
    expect(text()).not.toContain("next update");

    ledger = { ...base, gameRunning: true };
    await showLedger();
    expect(text()).toContain("Log out or /reload to include this session");

    // Gold logs alone, or a realm with only gold logs: nothing to export.
    ledger = { ...base, state: "ready" };
    await showLedger();
    expect(text()).toContain("Recorded at last logout");
    expect(text()).not.toContain("recorded yet");
    expect(exportButton().disabled).toBe(true);
    expect(text()).toContain("Nothing to export yet");

    // The row says what Export writes: the realm shown, every character and period.
    ledger = { ...base, state: "ready", exportable: true };
    await showLedger();
    expect(exportButton().disabled).toBe(false);
    expect(exportButton().textContent).toBe("Export");
    expect(text()).toContain("All realms · every character and period");
    expect(text()).not.toContain("Nothing to export yet");
    ledger = {
      ...base,
      state: "ready",
      exportable: true,
      realms: ["Soulseeker"],
      realm: "Soulseeker",
    };
    await showLedger();
    expect(text()).toContain("Soulseeker · every character and period");

    ledger = { ...base, state: "noAddon", accounts: [], account: null, recordedAt: null };
    await showLedger();
    expect(text()).toContain("Install TradeSkillMaster to start recording");
    expect(text()).not.toContain("Recorded at last logout");
    // Files without records from before the addon was removed: nothing to
    // date, and nothing this session will record.
    ledger = { ...base, state: "noAddon", gameRunning: true };
    await showLedger();
    expect(text()).toContain("Install TradeSkillMaster to start recording");
    expect(text()).not.toContain("Recorded at last logout");
    expect(text()).not.toContain("include this session");

    ledger = { ...base, state: "noAccount", accounts: [], account: null, recordedAt: null };
    await showLedger();
    expect(text()).toContain("Nothing recorded yet");
    expect(text()).toContain("log out or /reload");

    // A failed read is an error, never an empty Ledger (A9).
    ledger = new Error("TradeSkillMaster.lua is invalid");
    await showLedger();
    expect(text()).toContain("Couldn't read TradeSkillMaster's records");
    expect(text()).not.toContain("recorded yet");
  } finally {
    ledger = base;
    await view.close();
    setSystemTime();
  }
});

test("the open Ledger reloads after a save and when WoW starts or stops", async () => {
  setSystemTime(new Date("2026-11-24T12:00:00Z"));
  resetTsmView();
  resetLedgerFilters();
  const previous = ledger;
  const base: TradeSkillMasterLedger = {
    state: "noRecords",
    accounts: ["MAIN"],
    account: "MAIN",
    recordedAt: Date.now() - 2 * 3_600_000,
    gameRunning: false,
    retail: false,
    wowhead: "classic",
    ...noFilters,
  };
  ledger = base;
  const view = await mountDestination();
  const changed = (installationId: string) =>
    act(async () =>
      fake.emit({ event: "tradeskillmaster.ledgerChanged", params: { installationId } }),
    );
  const text = () => view.container.textContent ?? "";
  try {
    await showLedger(view.container);
    expect(text()).toContain("Recorded at last logout · 2 hours ago");
    expect(text()).not.toContain("include this session");
    const reads = ledgerRequests.length;

    ledger = { ...base, gameRunning: true };
    await changed("inactive");
    expect(ledgerRequests).toHaveLength(reads);
    await changed("active");
    expect(ledgerRequests).toHaveLength(reads + 1);
    expect(text()).toContain("Log out or /reload to include this session");

    ledger = { ...ledger, recordedAt: Date.now() - 120_000 };
    await changed("active");
    expect(ledgerRequests).toHaveLength(reads + 2);
    expect(text()).toContain("Recorded at last logout · 2 minutes ago");
    expect(text()).toContain("Log out or /reload to include this session");

    ledger = { ...ledger, gameRunning: false };
    await changed("active");
    expect(ledgerRequests).toHaveLength(reads + 3);
    expect(text()).toContain("Recorded at last logout · 2 minutes ago");
    expect(text()).not.toContain("include this session");
  } finally {
    ledger = previous;
    await view.close();
    setSystemTime();
  }
});

test("entering the remembered Ledger before its records arrive lands on its first row once they do", async () => {
  resetTsmView();
  tsmView.set("ledger");
  resetFocusMemory();
  let release = () => {};
  holdLedger = new Promise((resolve) => (release = resolve));
  ledger = {
    state: "noRecords",
    accounts: ["MAIN"],
    account: "MAIN",
    recordedAt: Date.now(),
    gameRunning: false,
    retail: false,
    wowhead: "classic",
    ...noFilters,
  };
  const view = await mountDestination();
  // The destination row in the list, which Right leaves for the pane.
  const listRow = document.createElement("div");
  listRow.tabIndex = -1;
  document.body.append(listRow);
  try {
    await act(async () => listRow.focus());
    browseZone.zone = "pane";
    focusTsmEntry(view.container);
    // Only a loading line under the bar so far: nothing to land on.
    expect(view.container.textContent).toContain("Reading TradeSkillMaster's records");
    expect(document.activeElement).toBe(listRow);
    await act(async () => release());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    // The recorded line is plain text and Export has nothing to write: the
    // first row is the empty state.
    expect(document.activeElement?.textContent).toContain(
      "No sales, purchases or gold recorded yet",
    );

    // The player moving on first keeps focus where they put it.
    await view.leave();
    resetTsmReads();
    holdLedger = new Promise((resolve) => (release = resolve));
    await view.render();
    await act(async () => listRow.focus());
    focusTsmEntry(view.container);
    browseZone.zone = "list";
    await act(async () => release());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(listRow);
  } finally {
    holdLedger = undefined;
    browseZone.zone = "nav";
    await view.close();
  }
});

test("a rebuilt pane puts focus back on the Ledger row the player was on", async () => {
  resetTsmView();
  tsmView.set("ledger");
  resetFocusMemory();
  ledger = {
    state: "noRecords",
    accounts: ["MAIN"],
    account: "MAIN",
    recordedAt: Date.now(),
    gameRunning: false,
    retail: false,
    wowhead: "classic",
    ...noFilters,
  };
  let view = await mountDestination();
  const emptyRow = () =>
    [...view.container.querySelectorAll<HTMLElement>(".Focusable[tabindex]")].find((e) =>
      e.textContent?.includes("No sales, purchases or gold"),
    )!;
  try {
    await act(async () => emptyRow().focus());
    await view.close();
    // A modal or menu rebuilt the panel (G4); the pane restores by identity.
    view = await mountDestination();
    await act(async () => {
      restoreFocus(browseFocusView("tsm"));
    });
    expect(document.activeElement).toBe(emptyRow());
  } finally {
    await view.close();
  }
});

test("the pill bar ends in Valve's scroll fade once the pane has scrolled under it", async () => {
  resetTsmView();
  const view = await mountDestination();
  const bar = view.container.querySelector(".wowdeck-pane-bar")!;
  const scroll = (top: number) =>
    act(async () => {
      view.container.scrollTop = top;
      view.container.dispatchEvent(new window.Event("scroll"));
    });
  try {
    expect(bar.hasAttribute("data-wowdeck-scrolled")).toBe(false);
    await scroll(40);
    expect(bar.hasAttribute("data-wowdeck-scrolled")).toBe(true);
    await scroll(0);
    expect(bar.hasAttribute("data-wowdeck-scrolled")).toBe(false);
  } finally {
    await view.close();
  }
});

/** A ready Ledger of two accounts, two realms and a few characters. */
const readyLedger: TradeSkillMasterLedger = {
  state: "ready",
  accounts: ["ALT", "MAIN"],
  account: "MAIN",
  recordedAt: Date.now(),
  gameRunning: false,
  retail: false,
  wowhead: "classic",
  realms: ["Argent Dawn", "Silvermoon"],
  realm: null,
  characters: [
    { id: "Hero - Argent Dawn", label: "Hero - Argent Dawn", kind: "character" },
    { id: "Hero - Silvermoon", label: "Hero - Silvermoon", kind: "character" },
    { id: "Trader - Silvermoon", label: "Trader - Silvermoon", kind: "character" },
  ],
  character: null,
  period: "All",
  itemCount: 3,
  exportable: true,
  figures: {
    earned: {
      total: 12_345_678,
      perDay: 301_114.1,
      topItem: "i:2589",
      topItemName: "Linen Cloth",
      trend: null,
    },
    spent: {
      total: 2_000_050,
      perDay: 48_781.7,
      topItem: "i:2592",
      topItemName: "Wool Cloth",
      trend: null,
    },
    profit: {
      total: 10_345_628,
      perDay: 252_332.4,
      topItem: "i:4306",
      topItemName: "Silk Cloth",
      trend: null,
    },
    dailySales: 3.66,
    dailyPurchases: 0.04,
    topSale: 1_000,
    topPurchase: 2_000_000,
  },
  gold: {
    points: [
      // Local midday this year, so the start reads "15 Jan" in every time zone.
      [new Date(new Date().getFullYear(), 0, 15, 12).getTime(), 1_000_000],
      [new Date(new Date().getFullYear(), 0, 16, 12).getTime(), 1_500_000],
      [new Date(new Date().getFullYear(), 0, 17, 12).getTime(), 1_200_000],
    ],
    high: 20_000_000,
    low: 500_000,
    dailyChange: -300_000,
  },
};

/** A Ledger control's button, under the floating title row. */
const segment = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLButtonElement>(`.wowdeck-browse-bar button[aria-label="${name}"]`);
const showLedger = (container: HTMLElement) =>
  act(async () =>
    (
      [...container.querySelectorAll(".wowdeck-tab")].find(
        (p) => p.textContent === "Ledger",
      ) as HTMLElement
    ).click(),
  );

test("All items pages native focus rows and refreshes only the opened filters", async () => {
  resetTsmView();
  resetTsmReads();
  resetLedgerFilters();
  resetFocusMemory();
  const previousLedger = ledger;
  const previousItems = fake.answers["tradeskillmaster.ledgerItems"];
  ledger = { ...readyLedger, realm: "Silvermoon", period: "1M", itemCount: 41 };
  const firstPage = [
    { itemString: "i:2589", name: "Linen Cloth", earned: 300, spent: 200, net: 100 },
    { itemString: "i:2592", name: "Wool Cloth", earned: 0, spent: 50, net: -50 },
    ...Array.from({ length: 38 }, (_, i) => ({
      itemString: `i:${i + 1}`,
      name: `Item ${i + 1}`,
      earned: 1,
      spent: 0,
      net: 1,
    })),
  ];
  const lastItem = { itemString: "i:4306", name: "Silk Cloth", earned: 1, spent: 0, net: 1 };
  let realmExists = true;
  fake.answers["tradeskillmaster.ledgerItems"] = ({ exact, realm, offset }) => {
    if (!realmExists && exact && realm === "Silvermoon") return { rows: [], nextOffset: null };
    return offset === 40
      ? { rows: [lastItem], nextOffset: null }
      : { rows: firstPage, nextOffset: 40 };
  };
  const view = await mountDestination(false);
  const opener = () =>
    [...view.container.querySelectorAll<HTMLElement>(".Focusable[tabindex]")].find(
      (row) => row.textContent === "All items (41)",
    )!;
  try {
    await showLedger(view.container);
    expect(view.container.textContent).toMatch(/Profit.*All items \(41\)/);
    const reads = fake.paramsOf("tradeskillmaster.ledgerItems").length;
    await act(async () => {
      opener().focus();
      opener().querySelector("b")!.click();
    });
    await view.leave(); // Opening a Steam modal unmounts the pane.
    const scope = {
      installationId: "active",
      account: "MAIN",
      exact: true,
      realm: "Silvermoon",
      period: "1M",
    } as const;
    expect(fake.paramsOf("tradeskillmaster.ledgerItems").slice(reads)).toEqual([
      { ...scope, offset: 0 },
    ]);

    expect(document.querySelector("h2")?.textContent).toBe(
      "All itemsMAIN · Silvermoon · All characters · 1M",
    );
    const columns = () => [...document.querySelectorAll(".wowdeck-ledger-items-columns")];
    expect(columns()).toHaveLength(41); // header plus one bounded page of item rows
    expect(
      columns()
        .slice(0, 3)
        .map((row) => [...row.children].map((cell) => cell.textContent)),
    ).toEqual([
      ["Item", "Earned", "Spent", "Net"],
      ["Linen Cloth", "3s", "2s", "1s"],
      ["Wool Cloth", "–", "50c", "-50c"],
    ]);
    expect(columns()[0]!.closest(".Focusable")).toBeNull();
    for (const row of columns().slice(1)) {
      const field = row.closest<HTMLElement>(".Focusable[tabindex]")!;
      await act(async () => field.focus());
      expect(document.activeElement).toBe(field);
    }
    const pageAction = (label: string) =>
      [...document.querySelectorAll<HTMLElement>(".Focusable[tabindex]")].find(
        (row) => row.textContent === label,
      );
    const turnPage = (label: string) =>
      act(async () => {
        const row = pageAction(label)!;
        row.focus();
        row.querySelector("b")!.click();
      });
    await turnPage("Next page");
    expect(columns()).toHaveLength(2);
    expect(document.activeElement).toBe(columns()[1]!.closest(".Focusable"));
    expect(document.activeElement?.textContent).toContain("Silk Cloth");
    expect(pageAction("Next page")).toBeUndefined();
    await turnPage("Previous page");
    expect(columns()).toHaveLength(41);
    expect(document.activeElement?.textContent).toContain("Linen Cloth");
    expect(pageAction("Previous page")).toBeUndefined();

    realmExists = false;
    await act(async () =>
      fake.emit({ event: "tradeskillmaster.ledgerChanged", params: { installationId: "active" } }),
    );
    expect(fake.paramsOf("tradeskillmaster.ledgerItems").slice(reads)).toEqual([
      { ...scope, offset: 0 },
      { ...scope, offset: 40 },
      { ...scope, offset: 0 },
      { ...scope, offset: 0 },
    ]);
    expect(document.querySelector("h2")?.textContent).toContain("Silvermoon · All characters · 1M");
    expect(document.body.textContent).toContain("No items bought or sold for these filters");
    expect(columns()).toHaveLength(0);
    const opens = qamOpens;
    await act(async () => cancelModal!());
    expect(qamOpens).toBe(opens + 1);
    await view.render();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(opener());
    expect(view.selected()?.textContent).toBe("Ledger");
  } finally {
    await act(async () => cancelModal && modalRoot && cancelModal());
    fake.answers["tradeskillmaster.ledgerItems"] = previousItems;
    ledger = previousLedger;
    await view.close();
    resetFocusMemory();
    resetTsmReads();
  }
});

test("All items opens an item on Wowhead with A, names unnamed items by ID and pages with L2 and R2", async () => {
  resetTsmView();
  resetTsmReads();
  resetLedgerFilters();
  resetFocusMemory();
  const previousLedger = ledger;
  const previousItems = fake.answers["tradeskillmaster.ledgerItems"];
  ledger = { ...readyLedger, itemCount: 4, wowhead: "mop-classic" };
  fake.answers["tradeskillmaster.ledgerItems"] = ({ offset }) =>
    offset === 40
      ? {
          rows: [{ itemString: "i:4306", name: "Silk Cloth", earned: 1, spent: 0, net: 1 }],
          nextOffset: null,
        }
      : {
          rows: [
            { itemString: "i:2589", name: "Linen Cloth", earned: 300, spent: 0, net: 300 },
            { itemString: "i:286742", name: "i:286742", earned: 0, spent: 70, net: -70 },
            { itemString: "p:39:1:3", name: "p:39:1:3", earned: 5, spent: 0, net: 5 },
          ],
          nextOffset: 40,
        };
  webPages.length = 0;
  const view = await mountDestination(false);
  const items = () =>
    [...document.querySelectorAll<HTMLElement>("[data-modal-root] .Focusable[tabindex]")].filter(
      (row) => row.querySelector(".wowdeck-ledger-items-columns"),
    );
  const trigger = (row: HTMLElement, button: number) =>
    act(async () => {
      row.dispatchEvent(
        new window.CustomEvent("gamepadbutton", { detail: { button }, cancelable: true }),
      );
    });
  try {
    await showLedger(view.container);
    const opener = [...view.container.querySelectorAll<HTMLElement>(".Focusable[tabindex]")].find(
      (row) => row.textContent === "All items (4)",
    )!;
    await act(async () => opener.querySelector("b")!.click());
    await view.leave();
    expect(items().map((row) => row.querySelector("span")?.textContent)).toEqual([
      "Linen Cloth",
      "Item 286742",
      "p:39:1:3",
    ]);
    // A item links to its page in the installation's section; a battle pet has no link.
    expect(items().map((row) => row.getAttribute("data-ok"))).toEqual([
      "Open on Wowhead",
      "Open on Wowhead",
      null,
    ]);
    const opens = qamOpens;
    await act(async () =>
      items()[1]!.querySelector<HTMLElement>(".wowdeck-ledger-items-columns")!.click(),
    );
    expect(webPages).toEqual(["https://www.wowhead.com/mop-classic/item=286742"]);
    // Steam's browser opens under a QAM dialog, so the list closes first
    // and the QAM stays closed for the page (DEVICE 2026-11-24, #319).
    expect(items()).toHaveLength(0);
    expect(qamOpens).toBe(opens);

    // The next All items comes back to the item opened, once.
    await view.render();
    const reopen = () =>
      [...view.container.querySelectorAll<HTMLElement>(".Focusable[tabindex]")]
        .find((row) => row.textContent === "All items (4)")!
        .querySelector("b")!;
    await act(async () => reopen().click());
    await view.leave();
    expect(items()).toHaveLength(3);
    expect(document.activeElement).toBe(items()[1]!);
    await act(async () => cancelModal && modalRoot && cancelModal());
    await view.render();
    await act(async () => reopen().click());
    await view.leave();
    expect(document.activeElement).toBe(items()[0]!);

    // R2 turns to the next page from any row, L2 back; the footer names each.
    expect([items()[0]!.getAttribute("data-l2"), items()[0]!.getAttribute("data-r2")]).toEqual([
      null,
      "Next page",
    ]);
    await trigger(items()[1]!, 8);
    expect(items().map((row) => row.querySelector("span")?.textContent)).toEqual(["Silk Cloth"]);
    expect([items()[0]!.getAttribute("data-l2"), items()[0]!.getAttribute("data-r2")]).toEqual([
      "Previous page",
      null,
    ]);
    await trigger(items()[0]!, 8); // Nothing after the last page.
    expect(items()).toHaveLength(1);
    await trigger(items()[0]!, 7);
    expect(items()).toHaveLength(3);
  } finally {
    await act(async () => cancelModal && modalRoot && cancelModal());
    fake.answers["tradeskillmaster.ledgerItems"] = previousItems;
    ledger = previousLedger;
    await view.close();
    resetFocusMemory();
    resetTsmReads();
  }
});

test("All items opens full width and lands on its first item once a page of more than 40 arrives", async () => {
  resetTsmView();
  resetTsmReads();
  resetLedgerFilters();
  resetFocusMemory();
  const previousLedger = ledger;
  const previousItems = fake.answers["tradeskillmaster.ledgerItems"];
  ledger = { ...readyLedger, realm: "Silvermoon", period: "1M", itemCount: 55 };
  const items = Array.from({ length: 55 }, (_, i) => ({
    itemString: `i:${i + 1}`,
    name: `Item ${i + 1}`,
    earned: 55 - i,
    spent: 0,
    net: 55 - i,
  }));
  // The rows arrive after Steam's dialog has taken focus, as on the Deck
  // with the real item cache.
  let release = () => {};
  let held = new Promise<void>((resolve) => (release = resolve));
  fake.answers["tradeskillmaster.ledgerItems"] = async ({ offset = 0 }) => {
    await held;
    return { rows: items.slice(offset, offset + 40), nextOffset: offset ? null : 40 };
  };
  const view = await mountDestination(false);
  const opener = () =>
    [...view.container.querySelectorAll<HTMLElement>(".Focusable[tabindex]")].find(
      (row) => row.textContent === "All items (55)",
    )!;
  const focused = () => document.activeElement?.textContent ?? "";
  const firstItem = () =>
    document.querySelectorAll(".wowdeck-ledger-items-columns")[1]?.closest(".Focusable");
  try {
    await showLedger(view.container);
    await act(async () => {
      opener().focus();
      opener().querySelector("b")!.click();
    });
    await view.leave(); // Opening a Steam modal unmounts the pane.

    // The dialog spans the screen: Steam's 660 px box takes our full-width class.
    const dialog = document.querySelector<HTMLElement>("[data-modal-root]")!;
    expect(dialog.classList.contains("wowdeck-full-width-modal")).toBe(true);
    expect(dialog.querySelector("style")?.textContent).toMatch(
      /\.wowdeck-full-width-modal\s*\{[^}]*width: 100%/,
    );

    // While reading, focus holds the top of the list, not Close at the
    // bottom: the header stays in view once the rows push Close down.
    expect(focused()).toBe("Reading Ledger items…");
    await act(async () => release());
    expect(firstItem()).not.toBeNull();
    expect(document.activeElement).toBe(firstItem()!);
    expect(focused()).toContain("Item 1");

    // A page turn reads the same way and lands on its first item too.
    held = new Promise<void>((resolve) => (release = resolve));
    const next = [...document.querySelectorAll<HTMLElement>(".Focusable[tabindex]")].find(
      (row) => row.textContent === "Next page",
    )!;
    await act(async () => {
      next.focus();
      next.querySelector("b")!.click();
    });
    expect(document.body.textContent).toContain("Reading Ledger items…");
    await act(async () => release());
    expect(document.activeElement).toBe(firstItem()!);
    expect(focused()).toContain("Item 41");
  } finally {
    release();
    await act(async () => cancelModal && modalRoot && cancelModal());
    fake.answers["tradeskillmaster.ledgerItems"] = previousItems;
    ledger = previousLedger;
    await view.close();
    resetFocusMemory();
    resetTsmReads();
  }
});

test("the Ledger's figures render under its freshness line: a 2×2 grid, then a Sales, Expenses and Profit table in coin colours", async () => {
  resetTsmView();
  resetTsmReads();
  resetLedgerFilters();
  resetFocusMemory();
  ledger = readyLedger;
  const view = await mountDestination();
  try {
    await showLedger(view.container);
    const text = view.container.textContent ?? "";
    // Entry lands on the first content row under the title row: the
    // Ledger's controls scroll with it, Account first with two accounts.
    expect(firstTsmControl(view.container)?.textContent).toContain("MAIN");
    const grid = view.container.querySelector(".wowdeck-ledger-grid")!;
    expect([...grid.children].map((cell) => cell.textContent)).toEqual([
      "Avg daily sales3.7",
      "Avg daily purchases0",
      "Top sale10s",
      "Top purchase200g",
    ]);
    // One caption row naming the columns, then a focus stop per row with
    // its top item in grey under it.
    const table = [...view.container.querySelectorAll(".wowdeck-ledger-flows")];
    expect(table.map((row) => [...row.children].map((cell) => cell.textContent))).toEqual([
      ["", "Total", "Per day"],
      ["Sales", "1,234g 56s 78c", "30g 11s 14c"],
      ["Expenses", "200g 50c", "4g 87s 82c"],
      ["Profit", "1,034g 56s 28c", "25g 23s 32c"],
    ]);
    expect(table[0]!.closest(".Focusable")).toBeNull();
    expect(table.slice(1).map((row) => row.closest(".Focusable[tabindex]")?.textContent)).toEqual([
      "Sales1,234g 56s 78c30g 11s 14cTop item · Linen Cloth",
      "Expenses200g 50c4g 87s 82cTop item · Wool Cloth",
      "Profit1,034g 56s 28c25g 23s 32cTop item · Silk Cloth",
    ]);
    // Each coin in WoW's colour, as TradeSkillMaster writes money.
    const coins = [...table[1]!.children[1]!.querySelectorAll(".wowdeck-money > span")];
    expect(coins.map((coin) => [coin.textContent, (coin as HTMLElement).style.color])).toEqual([
      ["1,234g", "rgb(255, 215, 10)"],
      [" 56s", "rgb(199, 199, 207)"],
      [" 78c", "rgb(237, 165, 95)"],
    ]);
    // The freshness line comes first, then the grid, then the table.
    expect(text.indexOf("Recorded at last logout")).toBeLessThan(text.indexOf("Avg daily sales"));
    expect(text.indexOf("Top purchase")).toBeLessThan(text.indexOf("Sales1,234g"));
    // All has no previous period, so no trend.
    expect(view.container.querySelector(".wowdeck-ledger-trend")).toBeNull();

    // A period trends: up is good for sales and profit, and bad for expenses.
    const week = readyLedger.figures!;
    ledger = {
      ...readyLedger,
      period: "1W",
      figures: {
        ...week,
        earned: { ...week.earned, trend: 5 },
        spent: { ...week.spent, trend: 5 },
        profit: { ...week.profit, trend: -5 },
      },
    };
    await view.leave();
    resetTsmReads();
    await view.render();
    const trends = [...view.container.querySelectorAll(".wowdeck-ledger-trend")];
    // Each row's trend stands beside its total and its per-day amount, as in game.
    expect(trends.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Up from the previous period",
      "Up from the previous period",
      "Up from the previous period",
      "Up from the previous period",
      "Down from the previous period",
      "Down from the previous period",
    ]);
    expect(trends.map((t) => t.getAttribute("data-good"))).toEqual([
      "true",
      "true",
      "false",
      "false",
      "false",
      "false",
    ]);
  } finally {
    ledger = readyLedger;
    await view.close();
  }
});

test("the Ledger's gold graph sits between the freshness line and the grid as one focus stop, or says there is no gold history", async () => {
  resetTsmView();
  resetTsmReads();
  resetLedgerFilters();
  resetFocusMemory();
  ledger = readyLedger;
  const view = await mountDestination();
  try {
    await showLedger(view.container);
    const graph = view.container.querySelector<HTMLElement>(".wowdeck-ledger-gold")!;
    // One focus stop holds the line, its dates and the summary (G3).
    const stop = graph.closest<HTMLElement>(".Focusable[tabindex]")!;
    expect(stop).not.toBeNull();
    expect(stop.querySelectorAll(".Focusable")).toHaveLength(0);
    const line = graph.querySelector("polyline")!;
    expect(line.getAttribute("points")!.trim().split(/\s+/)).toHaveLength(3);
    // 100g to 120g ends above its start: green, as the in-game graph colours it.
    expect(line.getAttribute("stroke")).toBe("#59bf40");
    expect(graph.querySelector("svg")!.getAttribute("aria-label")).toBe(
      "Gold from 15 Jan to now, between 100g and 150g",
    );
    // The in-game graph's axes: 100g to 150g pads to 100g to 160g with a
    // gridline every 32 px of the 96 px plot, and two days of 300 px are
    // labelled by weekday at each midnight.
    expect(
      [
        ...graph.querySelectorAll(".wowdeck-ledger-yaxis > span:not(.wowdeck-ledger-axis-sizer)"),
      ].map((l) => l.textContent),
    ).toEqual(["100g", "120g", "140g", "160g"]);
    expect(graph.querySelectorAll(".wowdeck-ledger-gridline")).toHaveLength(4);
    const weekday = (day: number) =>
      new Date(new Date().getFullYear(), 0, day).toLocaleDateString("en-GB", { weekday: "short" });
    expect(
      [...graph.querySelectorAll(".wowdeck-ledger-xaxis > span")].map((l) => l.textContent),
    ).toEqual([weekday(16), weekday(17)]);
    expect([...stop.querySelectorAll(".wowdeck-ledger-line")].map((l) => l.textContent)).toEqual([
      "52-week high2,000g",
      "52-week low50g",
      "Daily change-30g",
    ]);
    const text = view.container.textContent ?? "";
    expect(text.indexOf("Recorded at last logout")).toBeLessThan(text.indexOf("52-week high"));
    expect(text.indexOf("Daily change")).toBeLessThan(text.indexOf("Avg daily sales"));
    // Only Retail records gold in steps of 1,000g, and only there the graph says so.
    expect(text).not.toContain("1,000g");
    // A period that ends below its start is red.
    const [a, b, c] = readyLedger.gold!.points;
    ledger = {
      ...readyLedger,
      gold: {
        ...readyLedger.gold!,
        points: [c!, b!, a!].map(([, copper], i) => [[a, b, c][i]![0], copper]) as [
          number,
          number,
        ][],
      },
    };
    await view.leave();
    resetTsmReads();
    await view.render();
    expect(
      view.container.querySelector(".wowdeck-ledger-gold polyline")!.getAttribute("stroke"),
    ).toBe("#ef806c");

    ledger = {
      ...readyLedger,
      retail: true,
      gold: { ...readyLedger.gold!, high: 20_012_345, dailyChange: -317_000 },
    };
    await view.leave();
    resetTsmReads();
    await view.render();
    const retail = view.container.querySelector<HTMLElement>(".wowdeck-ledger-gold")!;
    // Retail rounds as the in-game Dashboard does: the summary to whole gold,
    // every other amount of 1g or more to the silver.
    expect([...retail.querySelectorAll(".wowdeck-ledger-line")].map((l) => l.textContent)).toEqual([
      "52-week high2,001g 23s",
      "52-week low50g",
      "Daily change-32g",
    ]);
    expect(
      [...view.container.querySelectorAll(".wowdeck-ledger-grid .wowdeck-ledger-value")].map(
        (v) => v.textContent,
      ),
    ).toEqual(["3.7", "0", "0c", "200g"]);
    expect(
      [
        ...view.container.querySelectorAll(".wowdeck-ledger-flows:not(.wowdeck-ledger-caption)"),
      ].map((r) => r.textContent),
    ).toEqual(["Sales1,234g 57s30g 11s", "Expenses200g 1s4g 88s", "Profit1,034g 56s25g 23s"]);
    expect(retail.querySelector(".wowdeck-ledger-note")?.textContent).toBe(
      "Retail records your gold in steps of 1,000g",
    );
    // Inside the graph's one focus stop, under the line.
    expect(retail.closest(".Focusable[tabindex]")!.querySelectorAll(".Focusable")).toHaveLength(0);

    // A first balance logged this minute is one point: a flat line across the
    // graph's bottom, a step of gold under its top gridline.
    const point: [number, number] = [Date.now(), 1_000_000];
    ledger = { ...readyLedger, gold: { ...readyLedger.gold!, points: [point] } };
    await view.leave();
    resetTsmReads();
    await view.render();
    expect(
      view.container.querySelector(".wowdeck-ledger-gold polyline")!.getAttribute("points"),
    ).toBe("0,96 300,96");

    ledger = { ...readyLedger, gold: null };
    await view.leave();
    resetTsmReads();
    await view.render();
    expect(view.container.querySelector(".wowdeck-ledger-gold")).toBeNull();
    const empty = [...view.container.querySelectorAll<HTMLElement>(".Focusable[tabindex]")].find(
      (e) => e.textContent?.includes("No gold history"),
    );
    expect(empty).toBeDefined();
    // The figures still follow.
    expect(view.container.querySelector(".wowdeck-ledger-grid")).not.toBeNull();
  } finally {
    ledger = readyLedger;
    await view.close();
  }
});

test("the Ledger asks for its gold graph sampled for the graph's own width", async () => {
  resetTsmView();
  resetTsmReads();
  resetLedgerFilters();
  ledger = readyLedger;
  ledgerRequests.length = 0;
  const view = await mountDestination();
  // The plot as wide as the QAM lays it out (jsdom lays out nothing).
  const svg = view.container.ownerDocument.defaultView!.SVGElement.prototype;
  const rect = svg.getBoundingClientRect;
  svg.getBoundingClientRect = function () {
    return { ...rect.call(this), width: 270.4 };
  };
  try {
    await showLedger(view.container);
    // The first read has no width yet; once the graph is laid out, it reads for its width.
    expect(ledgerRequests[0]).toEqual({ installationId: "active", period: "All" });
    expect(ledgerRequests[ledgerRequests.length - 1]).toEqual({
      installationId: "active",
      period: "All",
      plotWidth: 270,
    });
    expect(view.container.querySelector(".wowdeck-ledger-gold polyline")).not.toBeNull();
  } finally {
    svg.getBoundingClientRect = rect;
    resetLedgerFilters();
    await view.close();
  }
});

test("the Ledger's filters open in the pane and reset Realm on another account", async () => {
  resetTsmView();
  resetTsmReads();
  resetLedgerFilters();
  ledger = readyLedger;
  echoFilters = (shown, params) => ({
    ...shown,
    account: params.account ?? shown.account,
    realm: params.realm ?? null,
    // The engine keeps a character only where it is a choice.
    character:
      params.character && shown.characters.some((c) => c.id === params.character)
        ? params.character
        : null,
    period: params.period ?? "All",
  });
  ledgerRequests.length = 0;
  const view = await mountDestination();
  const pick = async (menu: string, choice: string) => {
    await act(async () => segment(view.container, menu)!.click());
    const entry = view.container.querySelector<HTMLButtonElement>(
      `.wowdeck-segment-menu button[aria-label="${choice}"]`,
    );
    expect([menu, choice, entry !== null]).toEqual([menu, choice, true]);
    await act(async () => entry!.click());
  };
  const values = () =>
    ["Account", "Realm", "Character", "Period"].map(
      (name) => segment(view.container, name)?.textContent ?? null,
    );
  try {
    await showLedger(view.container);
    expect(values()).toEqual(["MAIN", "All realms", "All characters", "All"]);
    // Every period the in-game Dashboard offers, in its order.
    await act(async () => segment(view.container, "Period")!.click());
    expect(
      [...view.container.querySelectorAll(".wowdeck-segment-menu button")].map(
        (b) => b.textContent,
      ),
    ).toEqual(["1D", "1W", "1M", "3M", "6M", "1Y", "2Y", "All"]);
    await act(async () =>
      view.container
        .querySelector<HTMLButtonElement>('.wowdeck-segment-menu button[aria-label="1M"]')!
        .click(),
    );
    await pick("Realm", "Silvermoon");
    await pick("Character", "Hero - Silvermoon");
    expect(values()).toEqual(["MAIN", "Silvermoon", "Hero - Silvermoon", "1M"]);
    expect(ledgerRequests[ledgerRequests.length - 1]).toEqual({
      installationId: "active",
      account: "MAIN",
      realm: "Silvermoon",
      character: "Hero - Silvermoon",
      period: "1M",
    });
    // The account already shown is no change: Realm and Character stay.
    await pick("Account", "MAIN");
    expect(values()).toEqual(["MAIN", "Silvermoon", "Hero - Silvermoon", "1M"]);
    expect(ledgerRequests[ledgerRequests.length - 1]).toEqual({
      installationId: "active",
      account: "MAIN",
      realm: "Silvermoon",
      character: "Hero - Silvermoon",
      period: "1M",
    });
    // Another account: Realm back to All, Character kept while it exists there.
    await pick("Account", "ALT");
    expect(ledgerRequests[ledgerRequests.length - 1]).toEqual({
      installationId: "active",
      account: "ALT",
      character: "Hero - Silvermoon",
      period: "1M",
    });
    expect(values()).toEqual(["ALT", "All realms", "Hero - Silvermoon", "1M"]);
    // Gone from the account: All characters.
    ledger = { ...readyLedger, characters: [] };
    await pick("Account", "MAIN");
    expect(values()).toEqual(["MAIN", "All realms", "All characters", "1M"]);

    // The selection outlives the panel (a modal or a QAM close rebuilds it).
    await view.leave();
    await view.render();
    expect(values()).toEqual(["MAIN", "All realms", "All characters", "1M"]);

    // One account: no Account filter.
    ledger = { ...readyLedger, accounts: ["MAIN"] };
    await view.leave();
    resetTsmReads();
    await view.render();
    expect(values()).toEqual([null, "All realms", "All characters", "1M"]);
  } finally {
    echoFilters = undefined;
    ledger = readyLedger;
    await view.close();
  }
});

test("only the title row floats: the Ledger's controls scroll with it, Account, Export, then Realm, Character and Period", async () => {
  resetTsmView();
  resetTsmReads();
  resetLedgerFilters();
  ledger = readyLedger;
  const view = await mountDestination();
  // Each control row's segments, by their wrappers' ids.
  const rows = () =>
    [...view.container.querySelectorAll(".wowdeck-browse-bar")].map((row) =>
      [...row.querySelectorAll("[data-wowdeck-segment]")].map((s) =>
        s.getAttribute("data-wowdeck-segment"),
      ),
    );
  const text = () => view.container.textContent ?? "";
  try {
    await showLedger(view.container);
    // The title row: the destination's name and its views' pills, nothing else.
    const bar = view.container.querySelector(".wowdeck-pane-bar")!;
    expect(bar.querySelector(".wowdeck-pane-title")?.textContent).toBe(
      "TradeSkillMasterAuction dataLedger",
    );
    expect(bar.querySelector(".wowdeck-browse-bar")).toBeNull();
    expect(bar.textContent).not.toContain("Export");
    expect(rows()).toEqual([["account"], ["realm", "character", "period"]]);
    // Export between them, then the recorded line as plain text.
    expect(text().indexOf("MAIN")).toBeLessThan(text().indexOf("Export ledger"));
    expect(text().indexOf("Export ledger")).toBeLessThan(text().indexOf("All realms"));
    expect(text().indexOf("All realms")).toBeLessThan(text().indexOf("Recorded at last logout"));
    expect(exportRowButton(view.container).disabled).toBe(false);
    const recorded = [...view.container.querySelectorAll("div")].find((el) =>
      el.textContent?.startsWith("Recorded at last logout"),
    )!;
    expect(recorded.closest(".Focusable")).toBeNull();
    // Left from Period goes to Character, from Character to Realm. Export and
    // Account are alone on their rows.
    expect(LEDGER_LEFT_NEIGHBOUR).toEqual({
      [LEDGER_FOCUS.period]: LEDGER_FOCUS.character,
      [LEDGER_FOCUS.character]: LEDGER_FOCUS.realm,
    });

    // One account: no Account row.
    ledger = { ...readyLedger, accounts: ["MAIN"] };
    await view.leave();
    resetTsmReads();
    await view.render();
    expect(rows()).toEqual([["realm", "character", "period"]]);
    expect(firstTsmControl(view.container)?.textContent).toBe("Export");

    // Without records there is nothing to filter, and Export still shows,
    // disabled and no focus stop: Steam's navigation stopped on a disabled
    // button although A did nothing there (DEVICE 2026-11-24).
    ledger = { ...readyLedger, accounts: ["MAIN"], state: "noRecords", ...noFilters };
    await view.leave();
    resetTsmReads();
    await view.render();
    expect(rows()).toEqual([]);
    expect(exportRowButton(view.container).disabled).toBe(true);
    expect(exportRowButton(view.container).closest(".Focusable")).toBeNull();
    expect(text()).toContain("Nothing to export yet");
  } finally {
    ledger = readyLedger;
    await view.close();
  }
});

test("Export picks a folder from Documents, then the remembered one, and toasts where the file went or why it failed", async () => {
  resetTsmView();
  resetTsmReads();
  resetLedgerFilters();
  resetFocusMemory();
  resetLedgerExport();
  exportFolder = null;
  exportRequests.length = 0;
  pickers.length = 0;
  toasts.length = 0;
  // Character and Period are set, and play no part in the export.
  ledger = {
    ...readyLedger,
    realm: "Silvermoon",
    character: "Hero - Silvermoon",
    period: "1M",
  };
  const view = await mountDestination();
  const pressExport = async () => {
    await act(async () => exportRowButton(view.container).click());
    // The picker's answer, the export and its toast.
    await act(settle);
  };
  try {
    await showLedger(view.container);
    // Cancelled: nothing is written, nothing is said, and focus is back on Export.
    await pressExport();
    expect(pickers).toEqual([{ type: 1, start: "/home/deck/Documents" }]);
    expect(exportRequests).toEqual([]);
    expect(toasts).toEqual([]);
    expect(rememberedFocus(browseFocusView("tsm"))).toBe(LEDGER_FOCUS.export);

    pickFolder = async (start) => ({ path: `${start}/Gold` });
    await pressExport();
    expect(exportRequests).toEqual([
      {
        installationId: "active",
        account: "MAIN",
        realm: "Silvermoon",
        folder: "/home/deck/Documents/Gold",
      },
    ]);
    expect(toasts).toEqual([
      {
        title: "Exported TradeSkillMaster records",
        body: "Saved to /home/deck/Documents/Gold/TSM_Silvermoon_2026-11-24.zip",
      },
    ]);

    // The next export starts in the folder the last one went to. All realms
    // sends no realm.
    ledger = { ...readyLedger };
    await view.leave();
    resetTsmReads();
    await view.render();
    exportFails = true;
    pickFolder = async (start) => ({ path: start });
    await pressExport();
    expect(pickers.slice(-1)).toEqual([{ type: 1, start: "/home/deck/Documents/Gold" }]);
    expect(exportRequests.slice(-1)).toEqual([
      {
        installationId: "active",
        account: "MAIN",
        folder: "/home/deck/Documents/Gold",
      },
    ]);
    expect(toasts.slice(-1)).toEqual([
      {
        title: "Couldn't export TradeSkillMaster records",
        body: "No permission to write to that folder",
      },
    ]);
    expect(rememberedFocus(browseFocusView("tsm"))).toBe(LEDGER_FOCUS.export);
  } finally {
    exportFails = false;
    pickFolder = async () => {
      throw new Error("cancel");
    };
    ledger = readyLedger;
    await view.close();
  }
});

test("Export says Exporting… while it runs, ignores presses until it ends, and logs a start folder it couldn't get", async () => {
  resetTsmView();
  resetTsmReads();
  resetLedgerFilters();
  resetFocusMemory();
  resetLedgerExport();
  exportFolder = null;
  exportRequests.length = 0;
  pickers.length = 0;
  toasts.length = 0;
  ledger = { ...readyLedger, realm: "Silvermoon" };
  const answers = { ...fake.answers };
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const view = await mountDestination();
  const button = () => exportRowButton(view.container);
  const press = async () => {
    await act(async () => button().click());
    await act(settle);
  };
  try {
    await showLedger(view.container);
    // The picker open: a second press opens no second picker.
    let choose!: (picked: { path: string }) => void;
    pickFolder = () => new Promise((resolve) => (choose = resolve));
    await press();
    await press();
    expect(pickers).toEqual([{ type: 1, start: "/home/deck/Documents" }]);

    // The export running: Export says so, and a press starts nothing.
    delete fake.answers["tradeskillmaster.ledgerExport"];
    await act(async () => {
      choose({ path: "/home/deck/Documents" });
      await settle();
    });
    expect(button().textContent).toBe("Exporting…");
    await press();
    expect(pickers).toHaveLength(1);
    expect(fake.pending("tradeskillmaster.ledgerExport")).toHaveLength(1);
    await act(() =>
      fake
        .next("tradeskillmaster.ledgerExport")
        .resolve({ path: "/home/deck/Documents/TSM_Silvermoon_2026-11-24.zip" }),
    );
    expect(button().textContent).toBe("Export");
    expect(toasts).toEqual([
      {
        title: "Exported TradeSkillMaster records",
        body: "Saved to /home/deck/Documents/TSM_Silvermoon_2026-11-24.zip",
      },
    ]);

    // The engine can't say where to start: the reason is logged, and the
    // picker starts where every picker does.
    fake.answers["tradeskillmaster.ledgerExportFolder"] = engineFailure("internal_error", "boom");
    pickFolder = async () => {
      throw new Error("cancel");
    };
    await press();
    expect(pickers.slice(-1)).toEqual([{ type: 1, start: pickerStartPath() }]);
    expect(
      warn.mock.calls.filter(([message]) => String(message).includes("Export's start folder")),
    ).toHaveLength(1);
  } finally {
    Object.assign(fake.answers, answers);
    warn.mockRestore();
    pickFolder = async () => {
      throw new Error("cancel");
    };
    ledger = readyLedger;
    await view.close();
  }
});
