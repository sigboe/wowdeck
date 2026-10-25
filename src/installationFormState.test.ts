/// <reference types="bun-types" />
import { beforeEach, describe, expect, test } from "bun:test";
import {
  getInstallationDraft,
  resetInstallationDraft,
  subscribeInstallationDraft,
  updateInstallationDraft,
  applyInspection,
} from "./installationFormState";

describe("installation draft store", () => {
  beforeEach(() => resetInstallationDraft());

  test("starts empty with auto client type", () => {
    expect(getInstallationDraft()).toEqual({
      path: "",
      name: "",
      clientType: "auto",
      autoName: "",
    });
  });
  test("patches merge and notify subscribers", () => {
    let calls = 0;
    const off = subscribeInstallationDraft(() => calls++);
    updateInstallationDraft({ path: "/games/wow" });
    updateInstallationDraft({ name: "Main" });
    expect(getInstallationDraft()).toEqual({
      path: "/games/wow",
      name: "Main",
      clientType: "auto",
      autoName: "",
    });
    expect(calls).toBe(2);
    off();
    updateInstallationDraft({ name: "x" });
    expect(calls).toBe(2);
  });
  test("a path set while nobody is mounted is still there on the next read", () => {
    updateInstallationDraft({ path: "/picked" });
    expect(getInstallationDraft().path).toBe("/picked");
  });
  test("reset clears", () => {
    updateInstallationDraft({ path: "/a", clientType: "retail" });
    resetInstallationDraft();
    expect(getInstallationDraft().path).toBe("");
  });
});

describe("applyInspection (owner, 2026-10-17)", () => {
  const draft = { path: "/x", name: "", clientType: "auto", autoName: "" };
  const forever = [{ gameType: "classic_beta", displayName: "Forever" }];
  const known = ["retail", "classic_beta"];
  test("fills the name and switches Auto to the detected version", () => {
    expect(applyInspection(draft, forever, known)).toEqual({
      name: "Forever",
      autoName: "Forever",
      clientType: "classic_beta",
    });
  });
  test("keeps a typed name and a chosen version; replaces its own earlier fill", () => {
    expect(
      applyInspection({ ...draft, name: "My WoW", clientType: "retail" }, forever, known),
    ).toEqual({});
    expect(
      applyInspection({ ...draft, name: "Retail", autoName: "Retail" }, forever, known).name,
    ).toBe("Forever");
  });
  test("nothing for zero or several installations, or an unknown version", () => {
    expect(applyInspection(draft, [], known)).toEqual({});
    expect(applyInspection(draft, [...forever, ...forever], known)).toEqual({});
    expect(
      applyInspection(draft, [{ gameType: "xptr", displayName: "X" }], known).clientType,
    ).toBeUndefined();
  });
});
