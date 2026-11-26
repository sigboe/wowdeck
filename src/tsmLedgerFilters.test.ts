/// <reference types="bun-types" />
import { beforeEach, expect, test } from "bun:test";
import {
  ledgerFilters,
  ledgerParams,
  pickLedgerFilter,
  resetLedgerFilters,
  settleLedgerFilters,
} from "./tsmLedgerFilters";

/** What the Ledger shows: the engine picked account MAIN. */
const shown = { account: "MAIN" } as const;

beforeEach(() => {
  resetLedgerFilters();
  pickLedgerFilter("era", shown, {
    realm: "Silvermoon",
    character: "Hero - Silvermoon",
    period: "1W",
  });
});

test("a pick keeps the bar's other filters and the shown account; another account resets Realm and keeps Character", () => {
  expect(ledgerParams(ledgerFilters.get("retail"))).toEqual({ period: "All" });
  pickLedgerFilter("era", shown, { character: null });
  pickLedgerFilter("era", shown, { period: "1M" });
  expect(ledgerParams(ledgerFilters.get("era"))).toEqual({
    account: "MAIN",
    realm: "Silvermoon",
    period: "1M",
  });
  // The same account again changes nothing.
  pickLedgerFilter("era", shown, { account: "MAIN" });
  expect(ledgerFilters.get("era").realm).toBe("Silvermoon");
  pickLedgerFilter("era", shown, { character: "Hero - Silvermoon", account: "ALT" });
  expect(ledgerFilters.get("era")).toEqual({
    account: "ALT",
    realm: null,
    character: "Hero - Silvermoon",
    period: "1M",
  });
  // Each installation keeps its own.
  expect(ledgerFilters.get("retail")).toEqual({ realm: null, character: null, period: "All" });
});

test("a filter the engine dropped is dropped from the bar's next request too", () => {
  pickLedgerFilter("era", shown, { account: "ALT" });
  const asked = ledgerFilters.get("era");
  // ALT has no such character: the engine showed All characters.
  expect(settleLedgerFilters("era", asked, { realm: null, character: null })).toEqual({
    account: "ALT",
    realm: null,
    character: null,
    period: "1W",
  });
  expect(ledgerFilters.get("era").character).toBeNull();
  // An answer for a selection the bar has moved on from changes nothing.
  pickLedgerFilter("era", { account: "ALT" }, { period: "1D" });
  expect(settleLedgerFilters("era", asked, { realm: null, character: null })).toBeNull();
  expect(ledgerFilters.get("era").period).toBe("1D");
});

test("a second pick before the first one's answer builds on the first", () => {
  pickLedgerFilter("era", shown, { account: "ALT" });
  // The Ledger still shows MAIN: ALT's answer has not arrived.
  pickLedgerFilter("era", shown, { period: "1M" });
  expect(ledgerFilters.get("era")).toEqual({
    account: "ALT",
    realm: null,
    character: "Hero - Silvermoon",
    period: "1M",
  });
});
