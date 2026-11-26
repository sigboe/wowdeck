import { expect, test } from "bun:test";
import type { UpdateAllProgress } from "../backend/src/api/contracts";
import { gamePageBoxView, type GamePageBoxInput, type GamePageBoxView } from "./gamePageBox";

const NOW = new Date(2026, 10, 26, 15, 0).getTime();
const AT_1432 = new Date(2026, 10, 26, 14, 32).getTime();
const retail = (updates: number) => ({ displayName: "Retail", updates });
const classic = (updates: number) => ({ displayName: "Classic Era", updates });

const view = (input: Partial<GamePageBoxInput>) =>
  gamePageBoxView({
    summary: null,
    checking: false,
    checkedAt: null,
    now: NOW,
    run: null,
    ...input,
  });
const line1 = (v: GamePageBoxView) => v.line1.map((p) => p.text).join("");

test("up to date: Check for updates in grey, when it was checked and where", () => {
  const v = view({ summary: [retail(0), classic(0)], checkedAt: AT_1432 });
  expect(line1(v)).toBe("WoW addons are up to date");
  expect(v.line2).toBe("Checked today at 14:32 · 2 installations");
  expect(v.action).toEqual({ label: "Check for updates", primary: false, inert: false });
  expect(v.spinner).toBe(false);
  expect(v.percent).toBeNull();

  // One installation names it; before a check this session, only where.
  expect(view({ summary: [retail(0)], checkedAt: AT_1432 }).line2).toBe(
    "Checked today at 14:32 · Retail",
  );
  expect(view({ summary: [retail(0), classic(0)] }).line2).toBe("2 installations");
});

test("updates waiting: Update all in blue, the count in Steam's green, the counts per installation", () => {
  const v = view({ summary: [retail(2), classic(1)], checkedAt: AT_1432 });
  expect(line1(v)).toBe("WoW addons · 3 updates ready");
  expect(v.line1.find((p) => p.tone === "count")?.text).toBe("3 updates");
  expect(v.line2).toBe("Retail 2 · Classic Era 1");
  expect(v.action).toEqual({ label: "Update all", primary: true, inert: false });

  // Installations without updates are left out of the counts.
  expect(view({ summary: [retail(1), classic(0)] }).line2).toBe("Retail 1");
  // One installation: when it was checked, else its name.
  expect(line1(view({ summary: [retail(1)] }))).toBe("WoW addons · 1 update ready");
  expect(view({ summary: [retail(1)], checkedAt: AT_1432 }).line2).toBe("Checked today at 14:32");
  expect(view({ summary: [retail(1)] }).line2).toBe("Retail");
});

test("checking: a spinner, the line 2 it had, and the action stays but does nothing", () => {
  const waiting = view({ summary: [retail(2), classic(1)], checking: true });
  expect(waiting.spinner).toBe(true);
  expect(line1(waiting)).toBe("Checking for updates…");
  expect(waiting.line2).toBe("Retail 2 · Classic Era 1");
  expect(waiting.action).toEqual({ label: "Update all", primary: true, inert: true });

  const current = view({ summary: [retail(0)], checking: true });
  expect(current.action).toEqual({ label: "Check for updates", primary: false, inert: true });
});

test("before the first summary: Loading…", () => {
  const v = view({});
  expect(line1(v)).toBe("WoW addons");
  expect(v.line2).toBe("Loading…");
  expect(v.action.label).toBe("Check for updates");
  expect(view({ checking: true }).line2).toBe("Loading…");
});

test("an Update all run: My Addons' wording, the addon on line 2, the bar from two addons on", () => {
  const summary = [retail(2), classic(1)];
  const all = (progress: UpdateAllProgress | null) =>
    view({ summary, run: { scope: "all", progress } });

  const checking = all(null);
  expect(checking.spinner).toBe(true);
  expect(line1(checking)).toBe("Checking for updates");
  expect(checking.line2).toBe("All installations");
  expect(checking.percent).toBeNull();
  expect(checking.action).toEqual({ label: "Update all", primary: true, inert: true });

  const one = all({ done: 0, total: 1, failed: 0, addonName: "Deadly Boss Mods" });
  expect(one.spinner).toBe(true);
  expect(line1(one)).toBe("Updating");
  expect(one.line2).toBe("Deadly Boss Mods");
  expect(one.percent).toBeNull();

  const many = all({ done: 2, total: 4, failed: 1, addonName: "Details" });
  expect(many.spinner).toBe(false);
  expect(line1(many)).toBe("Updating 3 of 4 · 50% · 1 failed");
  expect(many.line2).toBe("Details");
  expect(many.percent).toBe(50);

  // A run with nothing left to update still reads Update all (the summary may say 0).
  expect(view({ summary: [retail(0)], run: { scope: "all", progress: null } }).action.label).toBe(
    "Update all",
  );
  // My Addons' run over one installation, not yet started.
  expect(view({ summary, run: { scope: "installation", progress: null } }).line2).toBe("");
});
