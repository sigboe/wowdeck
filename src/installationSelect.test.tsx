import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeDeckyUi } from "./testing/fakeDeckyUi";
import type { Installation, SearchResult } from "./types";
import { createAddonSession, type AddonSessionDeps } from "./addonSession";

mock.module("@decky/ui", () => fakeDeckyUi);

const { InstallationSelect } = await import("./components/InstallationSelect");

function sessionWithInstallations() {
  const installations = [
    { id: "i1", displayName: "Retail", selected: true },
    { id: "i2", displayName: "Classic", selected: false },
  ] as Installation[];
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
