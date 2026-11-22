/**
 * The version module against the shared conformance table, which
 * tools/test_version.py runs against tools/version.py too.
 */
import { describe, expect, test } from "bun:test";
import table from "../src/api/version-table.json";
import {
  compareVersions,
  newestOffered,
  normalizeVersion,
  parseVersion,
  readVersion,
} from "../src/api/version";
import type { UpdateChannel } from "../src/api/contracts";

describe("version table: reading and writing", () => {
  for (const row of table.versions) {
    test(`${JSON.stringify(row.text)}: ${row.why}`, () => {
      expect(normalizeVersion(row.text)).toBe(row.reads);
      expect<string | null>(readVersion(row.text)?.form ?? null).toBe(row.form);
      expect(parseVersion(row.text) !== null).toBe(row.writes);
      if (row.writes) expect(parseVersion(row.text)?.text).toBe(row.text);
    });
  }
});

describe("version table: order", () => {
  for (const chain of table.order) {
    test(chain.join(" < "), () => {
      for (let i = 0; i < chain.length; i++) {
        for (let j = i + 1; j < chain.length; j++) {
          expect([chain[i], chain[j], compareVersions(chain[i]!, chain[j]!)]).toEqual([chain[i], chain[j], -1]);
          expect([chain[j], chain[i], compareVersions(chain[j]!, chain[i]!)]).toEqual([chain[j], chain[i], 1]);
        }
      }
    });
  }
  for (const [a, b] of table.equal) {
    test(`${a} = ${b}`, () => {
      expect(compareVersions(a!, b!)).toBe(0);
      expect(compareVersions(b!, a!)).toBe(0);
    });
  }
  test("a non-version compares as can't tell", () => {
    expect(compareVersions("banana", "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeNull();
  });
});

describe("version table: what a channel offers", () => {
  for (const row of table.offers) {
    test(`${row.channel} from [${row.candidates.join(", ")}]: ${row.why}`, () => {
      expect(newestOffered(row.channel as UpdateChannel, row.candidates)).toBe(row.offers);
    });
  }
});
