import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Steam supplies these controls at runtime. Keep their visible labels and
// disabled state while rendering outside Steam.
mock.module("@decky/ui", () => ({
  PanelSection: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  PanelSectionRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogButton: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => (
    <button disabled={disabled}>{children}</button>
  ),
  Focusable: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { FindWowWidget } = await import("./components/FindWowWidget");
const props = {
  installationCount: 0,
  detecting: false,
  result: null as string | null,
  onDetect: () => {},
  onOpenOptions: () => {},
};

describe("My Addons Find WoW widget", () => {
  test("offers detection and Steam library setup only without an installation", () => {
    const empty = renderToStaticMarkup(<FindWowWidget {...props} />);
    expect(empty).toContain("Find WoW");
    expect(empty).toContain("Steam library");
    expect(empty).toContain("WoW or Battle.net");
    expect(renderToStaticMarkup(<FindWowWidget {...props} installationCount={1} />)).toBe("");
  });

  test("shows the empty scan result and where to add a folder manually", () => {
    const html = renderToStaticMarkup(<FindWowWidget {...props} result="Found 0 installations" />);
    expect(html).toContain("Found 0 installations");
    expect(html).toContain("add its folder in Options");
  });

  test("shows progress with scanning disabled, and displays a failed scan", () => {
    const pending = renderToStaticMarkup(<FindWowWidget {...props} detecting />);
    expect(pending).toContain("Finding WoW");
    expect(pending).toContain("disabled");
    const failure = renderToStaticMarkup(<FindWowWidget {...props} result="Couldn’t find WoW" />);
    expect(failure).toContain("Couldn’t find WoW");
  });
});
