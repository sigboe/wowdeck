/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { copyText } from "./clipboard";

// copyText copies the way Steam's own UI does (spec #48): a textarea in the
// top window's document, selected, then execCommand("copy"). jsdom has no
// execCommand, so each test installs a stub on the document under test that
// records what was selected at the moment of the copy, i.e. what would land
// on the clipboard.

type CopyOutcome = boolean | Error;

interface CopyStub {
  /** Text selected in that document each time "copy" ran. */
  copied: string[];
}

function stubCopy(doc: Document, outcome: CopyOutcome = true): CopyStub {
  const stub: CopyStub = { copied: [] };
  doc.execCommand = (command: string) => {
    if (command !== "copy") {
      return false;
    }
    for (const area of Array.from(doc.querySelectorAll("textarea"))) {
      if (area.selectionEnd > area.selectionStart) {
        stub.copied.push(area.value.slice(area.selectionStart, area.selectionEnd));
      }
    }
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  };
  return stub;
}

const globals = globalThis as { window?: unknown };
const savedWindow = globals.window;

/**
 * Makes `dom` the plugin's window. `top` (when given) is Steam's window above
 * it; otherwise the plugin window is its own top, as in a plain page. jsdom's
 * own `top` is unforgeable, so the plugin window is a thin stand-in.
 */
function installWindow(dom: JSDOM, options?: { top?: JSDOM; steamClient?: unknown }): void {
  const win: Record<string, unknown> = { document: dom.window.document };
  win.top = options?.top ? options.top.window : win;
  if (options?.steamClient !== undefined) {
    win.SteamClient = options.steamClient;
  }
  globals.window = win;
}

function bodyChildren(dom: JSDOM): number {
  return dom.window.document.body.children.length;
}

afterEach(() => {
  globals.window = savedWindow;
});

describe("copyText", () => {
  test("multi-line text reaches the copy command with its newlines intact", async () => {
    const dom = new JSDOM("<!doctype html><body><p>plugin</p></body>");
    installWindow(dom);
    const stub = stubCopy(dom.window.document);
    const text = "WoWDeck 1.0.0\nEngine: ok\n\n  indented line\nlast";

    const result = await copyText(text);

    expect(result.ok).toBe(true);
    expect(stub.copied).toEqual([text]);
    expect(bodyChildren(dom)).toBe(1);
  });

  test("a copy command that returns false is a failure with a message", async () => {
    const dom = new JSDOM("<!doctype html><body></body>");
    installWindow(dom);
    stubCopy(dom.window.document, false);

    const result = await copyText("path");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("refused");
    expect(bodyChildren(dom)).toBe(0);
  });

  test("a copy command that throws is a failure whose message says so, and is logged", async () => {
    const dom = new JSDOM("<!doctype html><body></body>");
    installWindow(dom);
    stubCopy(dom.window.document, new Error("NotAllowedError"));
    const logged: unknown[][] = [];
    const savedError = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    let result;
    try {
      result = await copyText("code");
    } finally {
      console.error = savedError;
    }

    expect(result.ok).toBe(false);
    expect(result.message).toContain("NotAllowedError");
    expect(logged.length).toBe(1);
    expect(bodyChildren(dom)).toBe(0);
  });

  test("with a top window that has its own document, the copy runs against that document", async () => {
    const plugin = new JSDOM("<!doctype html><body><p>plugin</p></body>");
    const steam = new JSDOM("<!doctype html><body><div>steam</div></body>");
    installWindow(plugin, { top: steam });
    const pluginStub = stubCopy(plugin.window.document, false);
    const steamStub = stubCopy(steam.window.document, true);

    const result = await copyText("/home/deck/WoW/_retail_/Interface/AddOns/Details");

    expect(result.ok).toBe(true);
    expect(steamStub.copied).toEqual(["/home/deck/WoW/_retail_/Interface/AddOns/Details"]);
    expect(pluginStub.copied).toEqual([]);
    expect(bodyChildren(steam)).toBe(1);
    expect(bodyChildren(plugin)).toBe(1);
  });

  test("SteamClient.Browser.NotifyUserActivation is called when present", async () => {
    const dom = new JSDOM("<!doctype html><body></body>");
    let activations = 0;
    installWindow(dom, {
      steamClient: { Browser: { NotifyUserActivation: () => (activations += 1) } },
    });
    const stub = stubCopy(dom.window.document);

    const result = await copyText("text");

    expect(activations).toBe(1);
    expect(result.ok).toBe(true);
    expect(stub.copied).toEqual(["text"]);
    expect(bodyChildren(dom)).toBe(0);
  });

  test("a SteamClient without Browser is not an error", async () => {
    const dom = new JSDOM("<!doctype html><body></body>");
    installWindow(dom, { steamClient: { Input: {} } });
    const stub = stubCopy(dom.window.document);

    const result = await copyText("text");

    expect(result.ok).toBe(true);
    expect(stub.copied).toEqual(["text"]);
    expect(bodyChildren(dom)).toBe(0);
  });

  test("the element that had focus before the copy has it afterwards", async () => {
    const dom = new JSDOM("<!doctype html><body><button id=row>Details</button></body>");
    installWindow(dom);
    const doc = dom.window.document;
    stubCopy(doc);
    // Chromium focuses a textarea on select(); jsdom does not, so mimic it.
    const proto = dom.window.HTMLTextAreaElement.prototype;
    const select = proto.select;
    proto.select = function (this: HTMLTextAreaElement) {
      this.focus();
      select.call(this);
    };
    const row = doc.getElementById("row")!;
    row.focus();

    await copyText("text");

    expect(doc.activeElement).toBe(row);
  });
});
