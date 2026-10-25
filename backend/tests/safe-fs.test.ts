import { describe, expect, test } from "bun:test";
import { assertWithin, isSafeArchiveEntryPath, joinWithin, PathEscapeError } from "../src/wow/fs/safe-fs";

describe("safe-fs path containment", () => {
  test("joinWithin allows nested paths", () => {
    expect(joinWithin("/addons", "Foo", "sub", "file.lua")).toBe("/addons/Foo/sub/file.lua");
  });

  test("joinWithin rejects traversal", () => {
    expect(() => joinWithin("/addons", "..", "etc")).toThrow(PathEscapeError);
    expect(() => joinWithin("/addons", "Foo/../../..")).toThrow(PathEscapeError);
  });

  test("joinWithin rejects absolute segment smuggling", () => {
    expect(() => joinWithin("/addons", "/etc/passwd")).toThrow(PathEscapeError);
    expect(() => joinWithin("/addons", "C:\\windows")).toThrow(PathEscapeError);
    expect(() => joinWithin("/addons", "C:/evil")).toThrow(PathEscapeError);
  });

  test("assertWithin rejects sibling escape", () => {
    expect(() => assertWithin("/a/b", "/a/b/../c")).toThrow(PathEscapeError);
    expect(assertWithin("/a/b", "/a/b/c")).toBe("/a/b/c");
  });

  test("root itself is allowed", () => {
    expect(assertWithin("/a/b", "/a/b")).toBe("/a/b");
  });
});

describe("archive entry safety", () => {
  test("accepts normal relative entries", () => {
    expect(isSafeArchiveEntryPath("Foo/Foo.toc")).toBe(true);
    expect(isSafeArchiveEntryPath("Foo\\Sub\\x.lua")).toBe(true);
  });

  test("rejects traversal, absolute and empty entries", () => {
    expect(isSafeArchiveEntryPath("../evil.lua")).toBe(false);
    expect(isSafeArchiveEntryPath("Foo/../../evil.lua")).toBe(false);
    expect(isSafeArchiveEntryPath("/etc/passwd")).toBe(false);
    expect(isSafeArchiveEntryPath("\\windows\\evil")).toBe(false);
    expect(isSafeArchiveEntryPath("C:/evil")).toBe(false);
    expect(isSafeArchiveEntryPath("")).toBe(false);
    expect(isSafeArchiveEntryPath("Foo//x")).toBe(false);
    expect(isSafeArchiveEntryPath(".")).toBe(false);
  });
});
