/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { ERROR_TEXT_MAX, backendErrorMessage, errorText, rawErrorText } from "./errors";

describe("backendErrorMessage", () => {
  test("strips a Python traceback down to the engine message", () => {
    const raw =
      'Traceback (most recent call last):\n  File "main.py", line 1, in x\n    y()\nmain.BackendError: [internal_error] request to https://a failed: TypeError: getaddrinfo ETIMEOUT a';
    expect(rawErrorText(raw)).toBe(
      "request to https://a failed: TypeError: getaddrinfo ETIMEOUT a",
    );
    expect(backendErrorMessage(raw)).toBe("That took too long. Try again");
  });
  test("strips class prefix and code", () => {
    expect(rawErrorText(new Error("BackendError: [timeout] Request x timed out"))).toBe(
      "Request x timed out",
    );
    expect(backendErrorMessage(new Error("BackendError: [timeout] Request x timed out"))).toBe(
      "That took too long. Try again",
    );
  });
  test("engine sentences pass through; system and network errors become plain words (C06)", () => {
    expect(
      backendErrorMessage("That addon isn't in your list any more. Refresh and try again"),
    ).toBe("That addon isn't in your list any more. Refresh and try again");
    expect(backendErrorMessage("GET https://x failed: HTTP 403")).toBe(
      "The request wasn't accepted. Check the API key in Options",
    );
    expect(backendErrorMessage("install failed: Error: ENOSPC: no space left on device")).toBe(
      "Not enough free space",
    );
  });
  test("empty falls back", () => {
    expect(backendErrorMessage("")).toBe("Something went wrong");
  });
});

describe("errorText", () => {
  test("the plain message, cut at one length for every toast and inline error", () => {
    const long = `That addon can't be used: ${"x".repeat(300)}`;
    expect(errorText(new Error(long))).toBe(long.slice(0, ERROR_TEXT_MAX));
    expect(errorText(long).length).toBe(ERROR_TEXT_MAX);
  });
  test("maps like backendErrorMessage and is never empty", () => {
    expect(errorText("BackendError: [timeout] Request x timed out")).toBe(
      "That took too long. Try again",
    );
    expect(errorText("")).toBe("Something went wrong");
  });
});
