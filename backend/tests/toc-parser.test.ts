import { describe, expect, test } from "bun:test";
import { parseTocFile, parseTocText, stripColorCode, stripTextureCode } from "../src/wow/toc/TocParser";

const FIXTURES = import.meta.dir + "/fixtures/toc";

describe("TocParser", () => {
  test("parses a normal toc", async () => {
    const toc = await parseTocFile(`${FIXTURES}/normal.toc`);
    expect(toc.title).toBe("TestAddon");
    // codes stripped; leftover spaces match upstream behavior
    expect(toc.notes).toBe("A test addon with color codes and  textures");
    expect(toc.author).toBe("TestAuthor");
    expect(toc.version).toBe("1.2.3");
    expect(toc.interface).toEqual(["110002", "110005"]);
    expect(toc.website).toBe("https://example.com/testaddon");
    expect(toc.fileName).toBe("normal.toc");
  });

  test("strips color and texture codes", () => {
    expect(stripColorCode("|cFFFF0000Red|r Plain")).toBe("Red Plain");
    expect(stripTextureCode("Text |TInterface\\Icons\\X:16|t more")).toBe("Text  more");
  });

  test("handles localized values and provider ids", async () => {
    const toc = await parseTocFile(`${FIXTURES}/localized.toc`);
    expect(toc.title).toBe("TestAddon : Localized");
    expect(toc.author).toBe("Àuthor Ünïcode");
    expect(toc.curseProjectId).toBe("123456");
    expect(toc.wowInterfaceId).toBe("7890");
    expect(toc.wagoAddonId).toBe("abc123de");
  });

  test("missing version yields undefined", async () => {
    const toc = await parseTocFile(`${FIXTURES}/missing-version.toc`);
    expect(toc.title).toBe("MissingVersionAddon");
    expect(toc.version).toBeUndefined();
  });

  test("malformed toc yields empty values, never throws", async () => {
    const toc = await parseTocFile(`${FIXTURES}/malformed.toc`);
    expect(toc.title).toBeUndefined();
    expect(toc.interface).toEqual([]);
  });

  test("dependencies from Dependencies and RequiredDeps", async () => {
    const toc = await parseTocFile(`${FIXTURES}/dependencies.toc`);
    expect(toc.dependencies).toBe("Ace3, LibSharedMedia-3.0");
    expect(toc.dependencyList).toEqual(["Ace3", "LibSharedMedia-3.0", "SomeRequired"]);
  });

  test("load on demand flag", async () => {
    const toc = await parseTocFile(`${FIXTURES}/load-on-demand.toc`);
    expect(toc.loadOnDemand).toBe("1");
    expect(toc.partOf).toBe("BigSuite");
  });

  test("trailing whitespace and CRLF are tolerated", () => {
    const toc = parseTocText("x.toc", "## Title:   Spaced   \r\n## Version: 1\r\n");
    expect(toc.title).toBe("Spaced");
    expect(toc.version).toBe("1");
  });
});
