import { describe, expect, test } from "bun:test";
import { gameVersionForInstallation } from "../src/wow/utils/gameversion";

// DBM-Core's real multi-client TOC (Deck, 2026-10-16).
const DBM = ["11509", "16001", "20506", "30405", "38002", "40402", "50504", "120100", "120105"];

describe("gameVersionForInstallation", () => {
  test("picks the interface of the client this installation runs", () => {
    expect(gameVersionForInstallation(DBM, "1.60.1.70338")).toBe("1.60.1"); // Forever
    expect(gameVersionForInstallation(DBM, "1.15.9.70003")).toBe("1.15.9"); // Classic Era
    expect(gameVersionForInstallation(DBM, "12.1.0.12345")).toBe("12.1.0"); // retail, by major.minor
  });

  test("falls back to the closest match, then to nothing rather than a wrong version", () => {
    expect(gameVersionForInstallation(DBM, "1.60.9")).toBe("1.60.1"); // same major.minor
    expect(gameVersionForInstallation(DBM, "7.3.5")).toBeNull();
    expect(gameVersionForInstallation(DBM, undefined)).toBeNull();
  });

  test("a single interface stays as it is; the stored joined form parses too", () => {
    expect(gameVersionForInstallation(["50504"], "1.60.1")).toBe("5.5.4");
    expect(gameVersionForInstallation("16001, 120105".split(","), "1.60.1")).toBe("1.60.1");
    expect(gameVersionForInstallation([], "1.60.1")).toBeNull();
  });
});
