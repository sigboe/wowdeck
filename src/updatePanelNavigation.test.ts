/// <reference types="bun-types" />
import { beforeEach, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { deckyUiStub } from "./deckyUiStub";
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  GamepadButton: { DIR_LEFT: 11, DIR_RIGHT: 12 },
}));
const { optionsUpdateDirection, updateReturnDirection } = await import("./updatePanelNavigation");
const { registerFocusElement, resetFocusMemory } = await import("./focusMemory");
const { QAM_VIEW } = await import("./qamState");

type DirectionEvent = Parameters<typeof optionsUpdateDirection>[0];
let dom: JSDOM;
let source: HTMLButtonElement;
let update: HTMLButtonElement;
let row: HTMLElement;
const direction = (button: number, target: HTMLElement) =>
  ({ detail: { button }, target }) as unknown as DirectionEvent;
const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 20 }) as DOMRect;

beforeEach(() => {
  resetFocusMemory();
  dom = new JSDOM(
    '<div id="scroller"><div data-options-row="last"><button id="source" class="Focusable gpfocus">Options</button></div></div><button id="update" class="Focusable">Update</button>',
  );
  source = dom.window.document.querySelector("#source")!;
  update = dom.window.document.querySelector("#update")!;
  row = source.parentElement!;
  source.getBoundingClientRect = () => rect(0, 40);
});

test("Right from a distant Options row reaches Update; Left restores the exact control and scroll", () => {
  const scroller = row.parentElement!;
  scroller.scrollTop = 420;
  registerFocusElement(QAM_VIEW.settings, "selfUpdateAction", update);
  update.addEventListener("focus", () => {
    scroller.scrollTop = 0;
  });
  expect(optionsUpdateDirection(direction(12, source))).toBe(true);
  expect(dom.window.document.activeElement).toBe(update);
  expect(updateReturnDirection(direction(11, update))).toBe(true);
  expect(dom.window.document.activeElement).toBe(source);
  expect(scroller.scrollTop).toBe(420);
});

test("Right keeps a row's own horizontal controls reachable first", () => {
  registerFocusElement(QAM_VIEW.settings, "selfUpdateAction", update);
  const next = dom.window.document.createElement("button");
  next.getBoundingClientRect = () => rect(50, 90);
  row.append(next);
  expect(optionsUpdateDirection(direction(12, source))).toBe(false);
  source.classList.remove("gpfocus");
  next.classList.add("gpfocus");
  expect(optionsUpdateDirection(direction(12, next))).toBe(true);
  expect(updateReturnDirection(direction(11, update))).toBe(true);
  expect(dom.window.document.activeElement).toBe(next);
});

test("no update target leaves Right and the other directions alone", () => {
  expect(optionsUpdateDirection(direction(12, source))).toBe(false);
  expect(optionsUpdateDirection(direction(11, source))).toBe(false);
});

test("a disabled update and a removed origin do not steal focus", () => {
  update.classList.add("Focusable");
  update.disabled = true;
  registerFocusElement(QAM_VIEW.settings, "selfUpdateAction", update, true);
  expect(optionsUpdateDirection(direction(12, source))).toBe(false);
  update.disabled = false;
  registerFocusElement(QAM_VIEW.settings, "selfUpdateAction", update);
  expect(optionsUpdateDirection(direction(12, source))).toBe(true);
  row.remove();
  expect(updateReturnDirection(direction(11, update))).toBe(false);
});
