/// <reference types="bun-types" />
import { beforeEach, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import {
  type FocusableElement,
  forgetFocus,
  registerFocusElement,
  rememberFocus,
  rememberedFocus,
  requestFocus,
  resetFocusMemory,
  restoreFocus,
  revealRemembered,
  subscribeFocusMemory,
} from "./focusMemory";

function fakeElement(child?: FocusableElement) {
  const el = {
    focused: 0,
    focus() {
      el.focused++;
    },
    querySelector: (_: string) => child ?? null,
  };
  return el;
}

let clock = 0;
beforeEach(() => {
  clock = 1000;
  resetFocusMemory(() => clock);
});

describe("focusMemory", () => {
  test("remembers the last key per view, independently", () => {
    rememberFocus("installed", "row:a");
    rememberFocus("settings", "browse");
    rememberFocus("installed", "row:b");
    expect(rememberedFocus("installed")).toBe("row:b");
    expect(rememberedFocus("settings")).toBe("browse");
    forgetFocus("settings");
    expect(rememberedFocus("settings")).toBeUndefined();
  });

  test("requestFocus remembers even when nothing is mounted yet (picked up on the next mount)", () => {
    expect(requestFocus("settings", "displayName")).toBe(false);
    expect(rememberedFocus("settings")).toBe("displayName");
  });

  test("a row is focused itself, never a child inside it", () => {
    const child = fakeElement();
    const row = fakeElement(child);
    registerFocusElement("installed", "row:a", row);
    expect(requestFocus("installed", "row:a")).toBe(true);
    expect(row.focused).toBe(1);
    expect(child.focused).toBe(0);
  });

  test("a wrapper slot focuses the first control inside it", () => {
    const child = fakeElement();
    const wrapper = fakeElement(child);
    registerFocusElement("settings", "gameVersion", wrapper, true);
    requestFocus("settings", "gameVersion");
    expect(child.focused).toBe(1);
    expect(wrapper.focused).toBe(0);
  });

  test("restoreFocus focuses the remembered row when it is mounted", () => {
    rememberFocus("installed", "row:b");
    const b = fakeElement();
    registerFocusElement("installed", "row:b", b);
    expect(restoreFocus("installed")).toBe(true);
    expect(b.focused).toBe(1);
  });

  test("a row that loads after the remount is focused when it appears", () => {
    rememberFocus("installed", "row:b");
    expect(restoreFocus("installed")).toBe(false);
    registerFocusElement("installed", "row:a", fakeElement());
    const b = fakeElement();
    clock += 500;
    registerFocusElement("installed", "row:b", b);
    expect(b.focused).toBe(1);
    // only once: a later re-render does not pull focus again
    registerFocusElement("installed", "row:b", b);
    expect(b.focused).toBe(1);
  });

  test("a waiting restore is dropped when the user focuses something else first", () => {
    rememberFocus("installed", "row:b");
    restoreFocus("installed");
    rememberFocus("installed", "row:a");
    const b = fakeElement();
    registerFocusElement("installed", "row:b", b);
    expect(b.focused).toBe(0);
  });

  test("a waiting restore expires", () => {
    rememberFocus("installed", "row:b");
    restoreFocus("installed");
    clock += 2001;
    const b = fakeElement();
    registerFocusElement("installed", "row:b", b);
    expect(b.focused).toBe(0);
  });

  test("a row that renders disabled first is focused once it can take focus (regression 2026-10-17)", () => {
    rememberFocus("settings", "export");
    const wrapper = fakeElement(); // disabled Field: nothing focusable inside yet
    registerFocusElement("settings", "export", wrapper, true);
    expect(restoreFocus("settings")).toBe(false);
    expect(wrapper.focused).toBe(0);
    const control = fakeElement();
    registerFocusElement("settings", "export", fakeElement(control), true); // re-render, data loaded
    expect(control.focused).toBe(1);
  });

  test("an element that is not a focus target is not focused; it waits", () => {
    rememberFocus("installed", "row:a");
    const notYet = Object.assign(fakeElement(), { matches: () => false });
    registerFocusElement("installed", "row:a", notYet);
    expect(restoreFocus("installed")).toBe(false);
    const ready = Object.assign(fakeElement(), { matches: () => true });
    registerFocusElement("installed", "row:a", ready);
    expect(ready.focused).toBe(1);
  });

  test("Steam's DialogButton takes focus without a tabindex; a disabled one waits (PC-16)", () => {
    const doc = new JSDOM(`<button class="DialogButton Focusable">All up to date</button>
      <button class="DialogButton Focusable" disabled>Busy</button>
      <div class="Focusable">group</div>`).window.document;
    const [button, disabled] = Array.from(doc.querySelectorAll("button"));
    const group = doc.querySelector("div")!;
    const focused: string[] = [];
    for (const el of [button!, disabled!, group]) {
      el.focus = () => focused.push(el.textContent ?? "");
    }
    registerFocusElement("installed", "updateAll", button!);
    registerFocusElement("installed", "busy", disabled!);
    registerFocusElement("installed", "group", group);
    expect(requestFocus("installed", "updateAll")).toBe(true);
    expect(requestFocus("installed", "busy")).toBe(false);
    expect(requestFocus("installed", "group")).toBe(false);
    expect(focused).toEqual(["All up to date"]);
  });

  test("revealRemembered scrolls the remembered row into view without focusing it", () => {
    rememberFocus("installed", "row:b");
    let scrolled = 0;
    const b = Object.assign(fakeElement(), {
      scrollIntoView: () => {
        scrolled++;
      },
    });
    registerFocusElement("installed", "row:b", b);
    expect(revealRemembered("installed")).toBe(true);
    expect(scrolled).toBe(1);
    expect(b.focused).toBe(0);
  });

  test("revealRemembered does nothing when nothing is remembered", () => {
    expect(revealRemembered("installed")).toBe(false);
  });
});

describe("subscribeFocusMemory", () => {
  test("reports every remembered row and stops after the unsubscribe", () => {
    const writes: string[] = [];
    const unsubscribe = subscribeFocusMemory((view, key) => writes.push(`${view}/${key}`));
    rememberFocus("settings", "provider:Curse");
    requestFocus("settings", "curseKey");
    unsubscribe();
    rememberFocus("settings", "other");
    expect(writes).toEqual(["settings/provider:Curse", "settings/curseKey"]);
  });
});
