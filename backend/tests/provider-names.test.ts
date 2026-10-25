import { describe, expect, test } from "bun:test";
import { providerDisplayName } from "../src/wow/errors";

// The names people know the addon sources by (C05), one per provider id.
const NAMES: Array<[string, string]> = [
  ["Curse", "CurseForge"],
  ["File", "Local file"],
  ["WowUpHub", "WowUp Hub"],
  ["WowInterface", "WoWInterface"],
  ["TukUI", "TukUI"],
  ["GitHub", "GitHub"],
];

describe("provider display names", () => {
  test.each(NAMES)("%p is shown as %p", (id, name) => {
    expect(providerDisplayName(id)).toBe(name);
  });

  test("an unknown id is shown as is", () => {
    expect(providerDisplayName("Wago")).toBe("Wago");
  });

  test("untrusted ids (import codes) never reach inherited keys", () => {
    expect(providerDisplayName("constructor")).toBe("constructor");
    expect(providerDisplayName("toString")).toBe("toString");
  });
});

describe("providers on the wire", () => {
  test("ProviderInfo.name is the name people know, the id stays the id", async () => {
    const { ProviderRegistry } = await import("../src/wow/providers/provider-registry");
    const { AddonProvider } = await import("../src/wow/providers/addon-provider");
    const registry = new ProviderRegistry();
    class Hub extends AddonProvider {
      constructor() {
        super();
        this.name = "WowUpHub";
      }
    }
    registry.register(new Hub());
    expect(registry.providerInfos().map((p) => [p.id, p.name])).toEqual([["WowUpHub", "WowUp Hub"]]);
  });
});
