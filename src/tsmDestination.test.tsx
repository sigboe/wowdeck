import { expect, mock, test, setSystemTime, beforeEach } from "bun:test";
import type { ReactElement, ReactNode, Ref } from "react";
import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { fakeDeckyUi } from "./testing/fakeDeckyUi";
import { connectEngine } from "./engineLink";
import { createFakeEngine } from "./testSupport/fakeEngine";
import type {
  TradeSkillMasterAccount,
  TradeSkillMasterDestination,
  TradeSkillMasterLedger,
} from "../backend/src/api/contracts";
import type { Addon } from "./types";

// The addon session TsmAddon now writes through pulls in the plugin toasts,
// which import Decky's API: not installed outside the Deck.
mock.module("@decky/api", () => ({
  toaster: { toast: () => {} },
  openFilePicker: async () => {
    throw new Error("cancel");
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
} as const satisfies Partial<TradeSkillMasterLedger>;
let ledger: TradeSkillMasterLedger | Error = {
  state: "noRecords",
  accounts: ["MAIN"],
  account: "MAIN",
  recordedAt: null,
  gameRunning: false,
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
const notify = (event: { event: "tradeskillmaster.changed" }) =>
  fake.emit({ ...event, params: {} });
mock.module("@decky/ui", () => ({
  ...fakeDeckyUi,
  Navigation: {
    OpenQuickAccessMenu: () => {
      qamOpens++;
    },
  },
  QuickAccessTab: { Decky: 3 },
  GamepadButton: { DIR_LEFT: 13, DIR_RIGHT: 14 },
  Focusable: SteamFocusable,
  // A focusable Field is itself the focus target: its ref, and Steam's
  // onGamepadFocus when it takes focus.
  Field: (
    p: Parameters<typeof fakeDeckyUi.Field>[0] & {
      focusable?: boolean;
      ref?: Ref<HTMLDivElement>;
      onGamepadFocus?: () => void;
    },
  ) =>
    p.focusable ? (
      <div className="Focusable" tabIndex={-1} ref={p.ref} onFocus={p.onGamepadFocus}>
        {fakeDeckyUi.Field(p)}
      </div>
    ) : (
      fakeDeckyUi.Field(p)
    ),
  DialogButton: (p: Parameters<typeof fakeDeckyUi.DialogButton>[0]) => (
    <div className="Focusable" tabIndex={p.disabled ? undefined : -1}>
      {fakeDeckyUi.DialogButton(p)}
    </div>
  ),
  // Steam's disabled button is no focus stop.
  ButtonItem: (p: Parameters<typeof fakeDeckyUi.ButtonItem>[0]) => (
    <div className="Focusable" tabIndex={p.disabled ? undefined : -1}>
      {fakeDeckyUi.ButtonItem(p)}
    </div>
  ),
  ModalRoot: ({
    children,
    onCancel,
  }: {
    children?: import("react").ReactNode;
    onCancel(): void;
  }) => {
    cancelModal = onCancel;
    return <div>{children}</div>;
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
const { resetFocusMemory, restoreFocus } = await import("./focusMemory");
const { browseFocusView, browseZone } = await import("./browseSessionState");
const { TsmAddon } = await import("./components/TsmAddon");
const { resetTsmReads, putTsmAccount } = await import("./tsmReads");
const { TsmDestination, firstTsmControl, focusTsmEntry } =
  await import("./components/TsmDestination");
const { resetTsmView, tsmView } = await import("./tsmView");
const { LEDGER_FOCUS, LEDGER_LEFT_NEIGHBOUR } = await import("./components/TsmLedger");
const { resetLedgerFilters } = await import("./tsmLedgerFilters");
const { Focusable, GamepadButton } = await import("@decky/ui");

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
    expect(container.querySelector("h2")?.textContent).toBe("TradeSkillMaster");
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

test("the Ledger shows its freshness, the game-running line, each empty state and a disabled Export", async () => {
  setSystemTime(new Date("2026-11-24T12:00:00Z"));
  resetTsmView();
  const base: TradeSkillMasterLedger = {
    state: "noRecords",
    accounts: ["MAIN"],
    account: "MAIN",
    recordedAt: Date.now() - 2 * 3_600_000,
    gameRunning: false,
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
    const exportButton = [...view.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Export"),
    )!;
    expect(exportButton.disabled).toBe(true);
    expect(exportButton.textContent).toContain("Export arrives in the next update");

    ledger = { ...base, gameRunning: true };
    await showLedger();
    expect(text()).toContain("Log out or /reload to include this session");

    ledger = { ...base, state: "ready" };
    await showLedger();
    expect(text()).toContain("Recorded at last logout");
    expect(text()).not.toContain("recorded yet");

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
    expect(document.activeElement?.textContent).toContain("Recorded at last logout");

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
  realms: ["Argent Dawn", "Silvermoon"],
  realm: null,
  characters: [
    { id: "Hero - Argent Dawn", label: "Hero - Argent Dawn", kind: "character" },
    { id: "Hero - Silvermoon", label: "Hero - Silvermoon", kind: "character" },
    { id: "Trader - Silvermoon", label: "Trader - Silvermoon", kind: "character" },
  ],
  character: null,
  period: "All",
  figures: {
    earned: { total: 12_345_678, perDay: 301_114.1, topItem: "i:2589", trend: null },
    spent: { total: 2_000_050, perDay: 48_781.7, topItem: "i:2592", trend: null },
    profit: { total: 10_345_628, perDay: 252_332.4, topItem: "i:4306", trend: null },
    dailySales: 3.66,
    dailyPurchases: 0.04,
    topSale: 1_000,
    topPurchase: 2_000_000,
  },
};

const segment = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLButtonElement>(`.wowdeck-pane-bar button[aria-label="${name}"]`);
const showLedger = (container: HTMLElement) =>
  act(async () =>
    (
      [...container.querySelectorAll(".wowdeck-tab")].find(
        (p) => p.textContent === "Ledger",
      ) as HTMLElement
    ).click(),
  );

test("the Ledger's figures render under its freshness line: a 2×2 grid, then Sales, Expenses and Profit", async () => {
  resetTsmView();
  resetTsmReads();
  resetLedgerFilters();
  resetFocusMemory();
  ledger = readyLedger;
  const view = await mountDestination();
  try {
    await showLedger(view.container);
    const text = view.container.textContent ?? "";
    // Entry still lands on the first content row, below the floating bars.
    expect(firstTsmControl(view.container)?.textContent).toContain("Recorded at last logout");
    const grid = view.container.querySelector(".wowdeck-ledger-grid")!;
    expect([...grid.children].map((cell) => cell.textContent)).toEqual([
      "Avg daily sales3.7",
      "Avg daily purchases0",
      "Top sale10s",
      "Top purchase200g",
    ]);
    const panels = [...view.container.querySelectorAll(".wowdeck-ledger-panel")].map(
      (panel) => panel.textContent,
    );
    expect(panels).toEqual([
      "SalesTotal earned1,234g 56s 78cPer day30g 11s 14cTop itemi:2589",
      "ExpensesTotal spent200g 50cPer day4g 87s 82cTop itemi:2592",
      "ProfitTotal profit1,034g 56s 28cPer day25g 23s 32cTop itemi:4306",
    ]);
    // The freshness line comes first, then the grid, then the panels.
    expect(text.indexOf("Recorded at last logout")).toBeLessThan(text.indexOf("Avg daily sales"));
    expect(text.indexOf("Top purchase")).toBeLessThan(text.indexOf("Total earned"));
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
    expect(trends.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Up from the previous period",
      "Up from the previous period",
      "Down from the previous period",
    ]);
    expect(trends.map((t) => t.getAttribute("data-good"))).toEqual(["true", "false", "false"]);
  } finally {
    ledger = readyLedger;
    await view.close();
  }
});

test("the Ledger's filters float with the pill bar, open in the pane, and reset Realm on another account", async () => {
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
      `.wowdeck-pane-bar .wowdeck-segment-menu button[aria-label="${choice}"]`,
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

test("the Ledger's bar floats two rows: Realm, Character and Period, then Account and a disabled Export", async () => {
  resetTsmView();
  resetTsmReads();
  resetLedgerFilters();
  ledger = readyLedger;
  const view = await mountDestination();
  // Each floating row's segments, by their wrappers' ids.
  const rows = () =>
    [...view.container.querySelectorAll(".wowdeck-pane-bar .wowdeck-browse-bar")].map((row) =>
      [...row.querySelectorAll("[data-wowdeck-segment]")].map((s) =>
        s.getAttribute("data-wowdeck-segment"),
      ),
    );
  const exportButton = () =>
    [...view.container.querySelectorAll("button")].filter((b) =>
      b.textContent?.includes("Export arrives in the next update"),
    );
  try {
    await showLedger(view.container);
    expect(rows()).toEqual([
      ["realm", "character", "period"],
      ["account", "export"],
    ]);
    // Export sits at the top only, disabled, and entry skips it with the bar.
    expect(exportButton()).toHaveLength(1);
    expect(exportButton()[0]!.closest(".wowdeck-pane-bar")).not.toBeNull();
    expect(exportButton()[0]!.disabled).toBe(true);
    expect(firstTsmControl(view.container)?.textContent).toContain("Recorded at last logout");
    // Left from Export goes to Account, from Period to Character to Realm.
    expect(LEDGER_LEFT_NEIGHBOUR).toEqual({
      [LEDGER_FOCUS.export]: LEDGER_FOCUS.account,
      [LEDGER_FOCUS.period]: LEDGER_FOCUS.character,
      [LEDGER_FOCUS.character]: LEDGER_FOCUS.realm,
    });

    // One account: Export alone on the second row.
    ledger = { ...readyLedger, accounts: ["MAIN"] };
    await view.leave();
    resetTsmReads();
    await view.render();
    expect(rows()).toEqual([["realm", "character", "period"], ["export"]]);

    // Without records there is nothing to filter, and Export still shows.
    ledger = { ...readyLedger, accounts: ["MAIN"], state: "noRecords", ...noFilters };
    await view.leave();
    resetTsmReads();
    await view.render();
    expect(rows()).toEqual([["export"]]);
    expect(exportButton()).toHaveLength(1);
  } finally {
    ledger = readyLedger;
    await view.close();
  }
});
