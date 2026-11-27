import { describe, expect, mock, test } from "bun:test";
import type { DropdownItemProps, SingleDropdownOption } from "@decky/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeDeckyUi } from "./testing/fakeDeckyUi";
import type { Installation, SearchResult } from "./types";
import { createAddonSession } from "./addonSession";
import { connectEngine } from "./engineLink";
import { createFakeEngine } from "./testSupport/fakeEngine";

mock.module("@decky/api", () => ({
  toaster: { toast: () => {} },
}));

let dropdownProps: DropdownItemProps;
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

/** Retail (active) and Classic; `hidden` hides both, or only the ones listed. */
function sessionWithInstallations(hidden: boolean | string[] = false) {
  const isHidden = (id: string) => (Array.isArray(hidden) ? hidden.includes(id) : hidden);
  const installations = [
    { id: "i1", displayName: "Retail", selected: true, hidden: isHidden("i1") },
    { id: "i2", displayName: "Classic", selected: false, hidden: isHidden("i2") },
  ] as Installation[];
  // The picker's Unhide and the session it reloads share one engine; an
  // install never answers.
  const fake = createFakeEngine({
    "installations.update": (params) => {
      const found = installations.find((i) => i.id === params.installationId)!;
      found.hidden = params.hidden ?? found.hidden;
      return { installation: found };
    },
    "installations.list": () => ({ installations }),
    "installations.select": ({ installationId }) => ({
      installation: installations.find((i) => i.id === installationId) ?? null,
    }),
    "installations.recoveryStatus": { installations: [], stateFile: { status: "readable" } },
    "addons.list": { addons: [] },
  });
  connectEngine(fake);
  return createAddonSession({
    rpc: fake.rpc,
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

// #338: a menu holding only Unhide left the player no way to switch here.
test("hidden-active picker keeps its list and adds Unhide, which reloads its supplied session", async () => {
  const session = sessionWithInstallations(["i1"]);
  await session.reloadAll();
  renderToStaticMarkup(<InstallationSelect session={session} />);
  let ordinaryMenu = false;
  openDropdown(dropdownProps, () => {
    ordinaryMenu = true;
  });
  expect(ordinaryMenu).toBe(true);
  const options = dropdownProps.rgOptions.map((o) => renderToStaticMarkup(<>{o.label}</>));
  expect(options).toEqual([expect.stringContaining("Retail"), "Classic", "Unhide Retail"]);
  dropdownProps.onChange!(dropdownProps.rgOptions[2] as SingleDropdownOption);
  // Drain the mutation and reload promises without a wall-clock wait.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(session.get().installations.find((i) => i.id === "i1")!.hidden).toBe(false);
  expect(session.get().selectedId).toBe("i1");
  renderToStaticMarkup(<InstallationSelect session={session} />);
  expect(dropdownProps.rgOptions.map((o) => o.label)).toEqual(["Retail", "Classic"]);
});

test("a hidden-active picker switches to another installation", async () => {
  const session = sessionWithInstallations(["i1"]);
  await session.reloadAll();
  renderToStaticMarkup(<InstallationSelect session={session} />);
  dropdownProps.onChange!({ data: "i2", label: "Classic" });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(session.get().selectedId).toBe("i2");
});
