/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { removeConfirmation, removeInstallationConfirmation } from "./removeConfirm";

describe("removeConfirmation", () => {
  test("managed addon: reversible wording", () => {
    const c = removeConfirmation("Bagnon", true);
    expect(c.okText).toBe("Remove");
    expect(c.description).toContain("Bagnon");
    expect(c.description).toContain("install it again");
  });
  test("unmanaged folder: warns it cannot be reinstalled", () => {
    const c = removeConfirmation("OldAddon", false);
    expect(c.okText).toBe("Delete");
    expect(c.description).toContain("can't be reinstalled");
  });
});

describe("removeInstallationConfirmation", () => {
  test("says files are untouched and how to get it back", () => {
    const c = removeInstallationConfirmation("Retail");
    expect(c.description).toContain("stop managing Retail");
    expect(c.description).toContain("won't be deleted");
    expect(c.description).toContain("Find WoW installations");
  });
});

describe("removeConfirmation with libraries (WF-22)", () => {
  test("names what goes along", () => {
    expect(removeConfirmation("UsesLib", true, ["LibCore"]).description).toContain(
      "Also removes LibCore, which nothing else needs.",
    );
    expect(removeConfirmation("UsesLib", true).description).not.toContain("Also removes");
  });
});
