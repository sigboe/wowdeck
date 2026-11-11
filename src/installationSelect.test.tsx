import { describe, expect, mock, test } from "bun:test";
import type { DropdownItemProps } from "@decky/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeDeckyUi } from "./testing/fakeDeckyUi";
import type { Installation, SearchResult } from "./types";
import { createAddonSession, type AddonSessionDeps } from "./addonSession";

mock.module("@decky/api", () => ({
  toaster: { toast: () => {} },
  callable: () => async () => ({}),
  addEventListener: () => {},
  removeEventListener: () => {},
}));

let dropdownProps: DropdownItemProps;
let choices: { value: string; label: string }[] = [];
let choose: (value: string) => void;
let updateRpc: (params: { installationId: string; hidden: boolean }) => Promise<unknown>;
mock.module("./services/backend", () => ({
  rpc: (_method: string, params: { installationId: string; hidden: boolean }) => updateRpc(params),
}));
mock.module("./components/choiceMenu", () => ({
  showChoiceMenu: (
    _label: string,
    values: typeof choices,
    _current: unknown,
    onPick: typeof choose,
  ) => {
    choices = values;
    choose = onPick;
  },
}));
mock.module("@decky/ui", () => ({
  ...fakeDeckyUi,
  DropdownItem: (props: DropdownItemProps) => {
    dropdownProps = props;
    return fakeDeckyUi.DropdownItem(props as Parameters<typeof fakeDeckyUi.DropdownItem>[0]);
  },
}));

const { InstallationSelect } = await import("./components/InstallationSelect");

/**
 * Steam's dropdown on activation (DEVICE 2026-11-12, PR #211):
 * `if (onMenuWillOpen && onMenuWillOpen(ShowMenu) == false) return; ShowMenu()`.
 * The ordinary menu opens unless the handler returns false.
 */
function openDropdown(props: DropdownItemProps, showMenu: () => void) {
  if (props.onMenuWillOpen && (props.onMenuWillOpen(showMenu) as unknown) == false) return;
  showMenu();
}

function sessionWithInstallations(hidden = false) {
  const installations = [
    { id: "i1", displayName: "Retail", selected: true, hidden },
    { id: "i2", displayName: "Classic", selected: false, hidden },
  ] as Installation[];
  updateRpc = async (params) => {
    const found = installations.find((i) => i.id === params.installationId)!;
    found.hidden = params.hidden;
    return { installation: found };
  };
  return createAddonSession({
    rpc: (async (method: string) =>
      method === "installations.list"
        ? { installations }
        : method === "addons.install"
          ? new Promise(() => {})
          : { addons: [] }) as unknown as AddonSessionDeps["rpc"],
    toast: () => {},
    toastError: () => {},
    autoUpdateOn: () => false,
  });
}

// The props each view passes: My Addons, Get Addons, Options.
const sites = [
  { menuLabel: "Installation" },
  { menuLabel: "Installation", onMenuWillOpen: () => {} },
  { label: "Active installation", description: "Version 11.0.5" },
];

describe("installation selectors", () => {
  test("every selector is off with the reason while a catalogue install is pending", async () => {
    const session = sessionWithInstallations();
    await session.reloadAll();
    for (const site of sites) {
      const html = renderToStaticMarkup(<InstallationSelect session={session} {...site} />);
      expect(html).not.toContain("disabled");
      expect(html).toContain("Classic");
      expect(html).not.toContain("Wait for addon installs to finish.");
    }
    void session.actions.install({ providerId: "Curse", externalId: "1" } as SearchResult);
    for (const site of sites) {
      const html = renderToStaticMarkup(<InstallationSelect session={session} {...site} />);
      expect(html).toContain("disabled");
      expect(html).toContain("Wait for addon installs to finish.");
      if (site.description) {
        expect(html).toContain(site.description);
      }
    }
  });
});

test("hidden installations stay in Options and only the active one stays in browsing pickers", async () => {
  const session = sessionWithInstallations(true);
  await session.reloadAll();
  const html = renderToStaticMarkup(<InstallationSelect session={session} />);
  expect(html).toContain("Retail");
  expect(html).toContain("Hidden installation");
  expect(html).not.toContain("Classic");
  const options = renderToStaticMarkup(<InstallationSelect session={session} showHidden />);
  expect(options).toContain("Classic");
});

test("hidden-active picker offers only Unhide and reloads its supplied session", async () => {
  const session = sessionWithInstallations(true);
  await session.reloadAll();
  renderToStaticMarkup(<InstallationSelect session={session} />);
  let ordinaryMenu = false;
  openDropdown(dropdownProps, () => {
    ordinaryMenu = true;
  });
  expect(choices).toEqual([{ value: "unhide", label: "Unhide" }]);
  expect(ordinaryMenu).toBe(false);
  choose("unhide");
  // Drain the mutation and reload promises without a wall-clock wait.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(session.get().installations.find((i) => i.id === "i1")!.hidden).toBe(false);
  renderToStaticMarkup(<InstallationSelect session={session} showHidden />);
  dropdownProps.onChange!({ data: "i2", label: "Classic" });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(session.get().selectedId).toBe("i2");
});
