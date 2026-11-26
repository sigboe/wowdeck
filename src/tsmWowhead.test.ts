import { describe, expect, test } from "bun:test";
import { ledgerItemId, ledgerItemLabel, wowheadItemUrl } from "./tsmWowhead";

describe("Ledger item links", () => {
  test("an item string's item ID", () => {
    expect(ledgerItemId("i:2589")).toBe(2589);
    expect(ledgerItemId("i:212345::2:10354:1520")).toBe(212345);
    expect(ledgerItemId("p:39:1:3")).toBeNull();
    expect(ledgerItemId("Linen Cloth")).toBeNull();
  });

  test("the Wowhead page by section, by item ID only", () => {
    expect(wowheadItemUrl("", "i:19019")).toBe("https://www.wowhead.com/item=19019");
    expect(wowheadItemUrl("classic", "i:2589")).toBe("https://www.wowhead.com/classic/item=2589");
    expect(wowheadItemUrl("mop-classic", "i:212345::2:10354")).toBe(
      "https://www.wowhead.com/mop-classic/item=212345",
    );
    expect(wowheadItemUrl(null, "i:2589")).toBeNull();
    expect(wowheadItemUrl("classic", "p:39:1:3")).toBeNull();
  });

  test("an item without a cached name shows its item ID", () => {
    expect(ledgerItemLabel("Tin Ore", "i:2771")).toBe("Tin Ore");
    expect(ledgerItemLabel("i:286742", "i:286742")).toBe("Item 286742");
    expect(ledgerItemLabel("i:5941::1:2", "i:5941::1:2")).toBe("Item 5941");
    expect(ledgerItemLabel("p:39:1:3", "p:39:1:3")).toBe("p:39:1:3");
  });
});
