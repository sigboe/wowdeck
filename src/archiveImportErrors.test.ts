/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { friendlyArchiveError } from "./archiveImportErrors";

describe("friendlyArchiveError", () => {
  test("maps each stable archive code to its own sentence, whatever the backend message said", () => {
    expect(
      friendlyArchiveError({ code: "archive_not_supported", message: "page.zip: nope" }),
    ).toMatch(/isn't a zip, RAR or 7z/i);
    expect(
      friendlyArchiveError({ code: "archive_no_addons", message: "readme.zip: nope" }),
    ).toMatch(/no installable WoW addon folders/i);
    expect(
      friendlyArchiveError({ code: "archive_unreadable", message: "ENOENT nope.zip" }),
    ).toMatch(/can't be read/i);
    expect(
      friendlyArchiveError({ code: "archive_extraction_failed", message: "host tool nope" }),
    ).toMatch(/couldn't be unpacked/i);
  });

  test("an empty pick is a prompt, not a failure", () => {
    expect(
      friendlyArchiveError({ code: "invalid_request", message: "Pick an archive file first" }),
    ).toMatch(/pick an archive/i);
  });

  test("falls back to the backend's own message for an unmapped code (already a clear sentence)", () => {
    expect(
      friendlyArchiveError({ code: "unknown_code", message: "a clear backend sentence" }),
    ).toBe("a clear backend sentence");
  });
});
