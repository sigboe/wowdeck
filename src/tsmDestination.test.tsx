import { expect, mock, test, setSystemTime } from "bun:test";
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { fakeDeckyUi } from "./testing/fakeDeckyUi";

const listeners = new Set<(event: { event: string }) => void>();
const notify = (event: { event: string }) => {
  for (const listener of listeners) listener(event);
};
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

mock.module("./services/backend", () => ({
  rpc: async (method: string, params?: { installationId?: string }) => {
    if (method === "tradeskillmaster.account") await holdAccount;
    if (method === "tradeskillmaster.destination") await holdDestination;
    if (method === "addons.list") await holdAddons;
    if (method === "tradeskillmaster.cleanupPreview")
      return [
        {
          realmId: 1,
          name: "Cleanup realm",
          region: "EU",
          gameVersion: "Retail",
          auctionHouseType: "ALL",
        },
      ];
    if (method === "tradeskillmaster.removeAddons") {
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
      };
    }
    if (method === "tradeskillmaster.refresh") {
      refreshRequests.push(params);
      return;
    }
    if (method === "addons.list")
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
      };
    if (method === "tradeskillmaster.unfollow") {
      followRequests.push(params);
      if (failUnfollow) throw new Error("fixture failure");
      followed = false;
    }
    if (method === "tradeskillmaster.setFollow") {
      followRequests.push(params);
      await holdFollow;
      followed = !followed;
    }
    requests.push(params?.installationId ?? "");
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
                  params?.installationId === "inactive"
                    ? "Other installation"
                    : "Der Abyssische Rat",
                auctionHouseType: params?.installationId === "inactive" ? "HORDE" : "ALL",
                followed,
                owned: false,
                declined: false,
                updated,
              },
            ],
      regions: params?.installationId === "empty" ? [] : [{ id: 2, name: "EU", updated }],
    };
  },
  onBackendEvent: (listener: typeof notify) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
}));
mock.module("@decky/ui", () => ({
  ...fakeDeckyUi,
  Navigation: {
    OpenQuickAccessMenu: () => {
      qamOpens++;
    },
  },
  QuickAccessTab: { Decky: 3 },
  Focusable: ({
    children,
    ref,
  }: {
    children?: import("react").ReactNode;
    ref?: import("react").Ref<HTMLDivElement>;
  }) => <div ref={ref}>{children}</div>,
  DialogButton: (p: Parameters<typeof fakeDeckyUi.DialogButton>[0]) => (
    <div className="Focusable" tabIndex={p.disabled ? undefined : -1}>
      {fakeDeckyUi.DialogButton(p)}
    </div>
  ),
  ButtonItem: (p: Parameters<typeof fakeDeckyUi.ButtonItem>[0]) => (
    <div className="Focusable" tabIndex={-1}>
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
const { resetFocusMemory } = await import("./focusMemory");
const { TsmAddon } = await import("./components/TsmAddon");

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
    expect(container.textContent).toContain("Could not uninstall");
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
    expect(document.body.textContent).toContain("Could not unfollow");
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
      outcome === "cleanup unavailable" ? "Could not check account follows." : undefined;
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
      if (removalFails) expect(container.textContent).toContain("Could not uninstall completely");
      else expect(container.textContent).toContain("Install TradeSkillMaster");
      if (cleanupError) {
        expect(container.textContent).toContain("Addons removed. Could not check account follows.");
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
