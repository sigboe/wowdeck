import { describe, expect, test } from "bun:test";
import { CHANGELOG_ENTRY_COUNT, composeChangelog } from "../src/wow/providers/changelog";
import { AddonChannelType } from "../src/wow/types";

function entry(over: Partial<Parameters<typeof composeChangelog>[0][number]> = {}) {
  return {
    title: "1.0.0",
    channelType: AddonChannelType.Stable,
    releaseDate: "2026-05-04T10:00:00Z",
    body: "- notes",
    ...over,
  };
}

describe("composeChangelog", () => {
  test("shows three entries by default", () => {
    expect(CHANGELOG_ENTRY_COUNT).toBe(3);
  });

  test("renders a heading, channel/date line and body per entry, separated by rules", () => {
    const text = composeChangelog([entry({ title: "2.0.0" }), entry({ title: "1.0.0", channelType: AddonChannelType.Alpha })]);
    expect(text).toBe(
      "## 2.0.0\n\n_Release · 2026-05-04_\n\n- notes\n\n---\n\n## 1.0.0\n\n_Alpha · 2026-05-04_\n\n- notes",
    );
  });

  test("honours the limit argument", () => {
    const entries = [entry({ title: "a" }), entry({ title: "b" }), entry({ title: "c" })];
    expect(composeChangelog(entries, 2)).not.toContain("## c");
    expect(composeChangelog(entries, 0)).toBe("");
  });

  test("returns an empty string when no entry has notes", () => {
    expect(composeChangelog([entry({ body: "" }), entry({ body: null }), entry({ body: "  " })])).toBe("");
    expect(composeChangelog([])).toBe("");
  });

  test("keeps an entry without notes when another has some", () => {
    const text = composeChangelog([entry({ title: "2", body: "real" }), entry({ title: "1", body: undefined })]);
    expect(text).toContain("_No release notes provided._");
  });

  test("omits an unknown or epoch date", () => {
    expect(composeChangelog([entry({ releaseDate: undefined })])).toContain("_Release_");
    expect(composeChangelog([entry({ releaseDate: new Date(0).toISOString() })])).toContain("_Release_");
    expect(composeChangelog([entry({ releaseDate: "not a date" })])).toContain("_Release_");
  });

  test("flattens third-party titles to one line without heading markers", () => {
    const text = composeChangelog([entry({ title: "## v1\n# injected" })]);
    expect(text.startsWith("## v1 # injected\n")).toBe(true);
  });
});
