/// <reference types="bun-types" />
import { beforeEach, expect, test } from "bun:test";
import {
  ledgerFilters,
  ledgerParams,
  pickLedgerFilter,
  resetLedgerFilters,
  settleLedgerFilters,
} from "./tsmLedgerFilters";

const shown = {
  account: "MAIN",
  realm: "Silvermoon",
  character: "Hero - Silvermoon",
  period: "1W",
} as const;

beforeEach(resetLedgerFilters);

test("a pick starts from what the Ledger shows; another account resets Realm and keeps Character", () => {
  expect(ledgerParams(ledgerFilters.get("era"))).toEqual({ period: "All" });
  pickLedgerFilter("era", { ...shown, character: null }, { period: "1M" });
  expect(ledgerParams(ledgerFilters.get("era"))).toEqual({
    account: "MAIN",
    realm: "Silvermoon",
    period: "1M",
  });
  pickLedgerFilter("era", shown, { account: "ALT" });
  expect(ledgerFilters.get("era")).toEqual({
    account: "ALT",
    realm: null,
    character: "Hero - Silvermoon",
    period: "1W",
  });
  // The same account again changes nothing.
  pickLedgerFilter("era", shown, { account: "MAIN" });
  expect(ledgerFilters.get("era").realm).toBe("Silvermoon");
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
  pickLedgerFilter(
    "era",
    { ...shown, account: "ALT", realm: null, character: null },
    {
      period: "1D",
    },
  );
  expect(settleLedgerFilters("era", asked, { realm: null, character: null })).toBeNull();
  expect(ledgerFilters.get("era").period).toBe("1D");
});
