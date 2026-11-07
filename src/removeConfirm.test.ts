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

describe("removeConfirmation with libraries (ADR 0008)", () => {
  test("names every library left unneeded and offers to keep them", () => {
    const c = removeConfirmation("UsesLib", true, ["LibCore", "LibDeep", "LibDeeper"]);
    expect(c.description).toContain(
      "Nothing else needs LibCore, LibDeep and LibDeeper: remove them too, or keep them installed.",
    );
    expect(c.okText).toBe("Remove UsesLib only");
    expect(c.withLibrariesText).toBe("Remove all");
  });
  test("one library: Remove both", () => {
    const c = removeConfirmation("Baganator", true, ["Syndicator"]);
    expect(c.description).toContain(
      "Nothing else needs Syndicator: remove it too, or keep it installed.",
    );
    expect(c.withLibrariesText).toBe("Remove both");
  });
  test("none: a single Remove, as before", () => {
    const c = removeConfirmation("UsesLib", true);
    expect(c.okText).toBe("Remove");
    expect(c.withLibrariesText).toBeUndefined();
    expect(c.description).not.toContain("Nothing else needs");
  });
});
