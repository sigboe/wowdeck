/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, createElement, type ReactNode, type Ref } from "react";
import { createRoot } from "react-dom/client";

import { deckyUiStub } from "../deckyUiStub";

// Steam controls are the external boundary; retain native focus/disabled behavior.
mock.module("@decky/api", () => ({
  callable: () => async () => ({}),
  addEventListener: () => {},
  removeEventListener: () => {},
  toaster: { toast: () => {} },
  openFilePicker: () => {},
}));
mock.module("@decky/ui", () => ({
  ...deckyUiStub,
  DialogButton: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) =>
    createElement("button", { className: "Focusable", disabled }, children),
  Focusable: ({ children, ref }: { children: ReactNode; ref: Ref<HTMLDivElement> }) =>
    createElement("div", { ref }, children),
  PanelSectionRow: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));
const { useRestoreFocus } = await import("../components/FocusSlot");
const { ManualInstallTab } = await import("../components/browseTabs");

function BrowseControl({ view }: { view: string }) {
  useRestoreFocus(view);
  return createElement(ManualInstallTab, {
    sources: { openInstallations: () => {}, openSources: () => {}, providers: [], loaded: true },
  });
}

// The QAM widening service is the only module allowed to know how Steam's QAM
// widens (UI guide, "QAM widening measurements", DEVICE 2026-10-18): two root
// classes on the QAM BasicUI div plus a max-width lift on our tab container.
// Everything it needs it derives from the anchor element (our tab content
// root), so tests build a Steam-shaped tree in jsdom and hand the anchor over.
// jsdom specifically, like markdown.test.ts: it actually implements the
// CSSOM/MutationObserver behaviour the service depends on.

const COMPANION = "O_8CAFWLuCw8vwTgsYBIb";

interface QamFixture {
  anchor: HTMLElement;
  root: HTMLElement;
  tabContainer: HTMLElement;
}

/** The measured Steam QAM shape: BasicUI root > 348px clip column > tab container. */
function buildSteamQam(options?: {
  companionRule?: string | null;
  tabClass?: string;
  innerWrapper?: boolean;
}): QamFixture {
  // The measured 2026-10-19 rules: the readable class lifts inner widths, but
  // the visible 348 px clip (`._card1`) is widened only by the companion class
  // (`.O_8CAF… ._card1`). `._2orc8` is structural (absolute position + its own
  // transform) and must never be copied onto the root.
  const companionRule =
    options?.companionRule === undefined
      ? `<style>
          ._card1 { max-width: 348px; }
          .${COMPANION} ._card1 { max-width: 854px; }
          ._2orc8 { position: absolute; width: 854px; transform: translateX(506px); }
          ._2orc8.${COMPANION} ._2BB6uf { max-width: 806px; }
          .QAMFriendExpanded ._2BB6uf { max-width: 806px; }
        </style>`
      : options?.companionRule === null
        ? ""
        : `<style>${options.companionRule}</style>`;
  const inner = options?.innerWrapper
    ? `<div id="wide-wrapper" style="width: 806px">
        <div class="_card1" style="overflow: hidden">
          <div class="${options?.tabClass ?? "tab_undefined"}" style="max-width: 300px">
            <div id="anchor">plugin content</div>
          </div>
        </div>
      </div>`
    : `<div class="_card1" style="overflow: hidden">
        <div class="${options?.tabClass ?? "tab_undefined"}" style="max-width: 300px">
          <div id="anchor">plugin content</div>
        </div>
      </div>`;
  const dom = new JSDOM(`<!doctype html><html><body>${companionRule}
    <div id="qam-root" class="BasicUI x" style="width: 854px">
      ${inner}
    </div>
  </body></html>`);
  const doc = dom.window.document;
  return {
    anchor: doc.getElementById("anchor")!,
    root: doc.getElementById("qam-root")!,
    tabContainer: doc.querySelector(".tab_undefined") as HTMLElement,
  };
}

/**
 * Steam's native placeholder lives in Big Picture, separately from the QAM
 * document. Expanded changes its translation, not the QAM document's width.
 * jsdom has no layout engine: check the CSS constraints on every clipping
 * ancestor and the native viewport independently, never pretend a command is
 * a measured rectangle. DEVICE evidence: UI guide, QAM widening measurements.
 */
function nativePlaceholder(qam: QamFixture) {
  const doc = qam.anchor.ownerDocument;
  const style = doc.createElement("style");
  style.textContent =
    ".ViewPlaceholder { transform: translateX(506px); } " +
    ".ViewPlaceholder.Expanded { transform: translateX(0px); }";
  doc.head.append(style);
  const placeholder = doc.createElement("div");
  placeholder.className = "ViewPlaceholder";
  doc.body.append(placeholder);
  setQamExpander({
    live: true,
    setExpanded: (wide) => placeholder.classList.toggle("Expanded", wide),
  });
  return {
    visibleWidth: () =>
      854 -
      Number(
        /translateX\((\d+)px\)/.exec(doc.defaultView!.getComputedStyle(placeholder).transform)![1],
      ),
    expectUnclipped: () => {
      expect(doc.defaultView!.getComputedStyle(placeholder).transform).toBe("translateX(0px)");
      for (let el = qam.anchor.parentElement; el; el = el.parentElement) {
        const css = doc.defaultView!.getComputedStyle(el);
        const cap = parseFloat(css.maxWidth);
        // Every ancestor must permit the 854px QAM, including the clip column.
        expect(Number.isFinite(cap) ? cap : Infinity).toBeGreaterThanOrEqual(854);
      }
    },
  };
}

const {
  attachQamWidening,
  COLLAPSE_HOLD_MS,
  detachQamWidening,
  enforceStep,
  qamWideningStatus,
  resetQamWidening,
  setQamExpander,
  setQamWidening,
  stopQamWidening,
  subscribeQamLayout,
  WIDENING_REAPPLY_MS,
} = await import("./qamWidening");

/** Every state lever 2 was sent, freshly installed per test. */
let expandCalls: boolean[] = [];

/** A live expander (Steam's QAM renders through it) recording what it is sent. */
function recordingExpander(live = true) {
  return { live, setExpanded: (expanded: boolean) => void expandCalls.push(expanded) };
}

beforeEach(() => {
  expandCalls = [];
  setQamExpander(recordingExpander());
});

/** MutationObserver delivery plus the service's coalescing window. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, WIDENING_REAPPLY_MS + 200));
}

/** The collapse hold plus the service's re-enforce pass. */
async function slid(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, COLLAPSE_HOLD_MS + 100));
}

afterEach(() => {
  resetQamWidening();
});

describe("QAM widening availability", () => {
  test("detects the mechanism on a Steam-shaped QAM tree", () => {
    const qam = buildSteamQam();
    expect(attachQamWidening(qam.anchor)).toBe(true);
    expect(qamWideningStatus().available).toBe(true);
  });

  test("still attaches on a build whose rules key only the readable class", () => {
    const qam = buildSteamQam({
      companionRule: ".QAMFriendExpanded .wmIAbjrkSc4iOyPUxSP76 { max-width: unset; }",
    });
    expect(attachQamWidening(qam.anchor)).toBe(true);
  });

  test("reports the mechanism unavailable when the widening CSS is missing", () => {
    const qam = buildSteamQam({ companionRule: null });
    expect(attachQamWidening(qam.anchor)).toBe(false);
    expect(qamWideningStatus().available).toBe(false);
  });

  test("unavailable when Steam's widening rules are gone, even with other wide rules (GA-12)", () => {
    // DEVICE 2026-10-20: with the QAMFriendExpanded rules removed, Steam's other
    // wide rules (`.BasicUI ._2jPMy… { ≥ 800px }`) were taken for companions and
    // the native view slid out over a page that could not widen.
    const qam = buildSteamQam({
      companionRule: ".BasicUI ._2jPMy ._1uS70 { max-width: 1000px; } .x ._wide { width: 900px; }",
    });
    expect(attachQamWidening(qam.anchor)).toBe(false);
    setQamWidening(true);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
  });

  test("reports the mechanism unavailable when no tab container surrounds the plugin", () => {
    const qam = buildSteamQam();
    qam.tabContainer.className = "";
    qam.tabContainer.style.maxWidth = "";
    expect(attachQamWidening(qam.anchor)).toBe(false);
  });

  test("attaching without any DOM anchor keeps the service usable and unavailable", () => {
    resetQamWidening();
    expect(qamWideningStatus()).toEqual({ available: false, applied: false });
  });
});

describe("QAM widening apply and revert", () => {
  test("widening adds the readable class, the companion the clip rule needs, and lifts the cap", () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
    expect(qam.root.classList.contains(COMPANION)).toBe(true);
    expect(qam.tabContainer.style.maxWidth).toBe("none");
    expect(qamWideningStatus().applied).toBe(true);
  });

  test("never copies a structural class that has its own standalone rule", () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    expect(qam.root.classList.contains("_2orc8")).toBe(false);
  });

  test("adds a companion compounded with the readable class on the same element", () => {
    const qam = buildSteamQam({
      companionRule: ".QAMFriendExpanded.O_8CAFWLuCw8vwTgsYBIb { max-width: 854px; }",
    });
    expect(attachQamWidening(qam.anchor)).toBe(true);
    setQamWidening(true);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
    expect(qam.root.classList.contains(COMPANION)).toBe(true);
  });

  test("puts the class on the outermost wide root, not an inner >= 800px wrapper", () => {
    const qam = buildSteamQam({ innerWrapper: true });
    expect(attachQamWidening(qam.anchor)).toBe(true);
    setQamWidening(true);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
    expect(qam.anchor.ownerDocument.getElementById("wide-wrapper")!.className).toBe("");
  });

  test("collapsing removes the classes and restores the stylesheet cap", async () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    setQamWidening(false);
    await slid();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
    expect(qam.root.classList.contains(COMPANION)).toBe(false);
    expect(qam.tabContainer.style.maxWidth).toBe("");
    expect(qamWideningStatus().applied).toBe(false);
  });

  test("with the mechanism unavailable, setting widened changes nothing and throws nothing", () => {
    const qam = buildSteamQam({ companionRule: null });
    expect(attachQamWidening(qam.anchor)).toBe(false);
    setQamWidening(true);
    expect(qam.root.className).toBe("BasicUI x");
    // the fixture carries the 300 px cap inline (for the structural fallback);
    // unavailable means untouched, i.e. exactly what it was before
    expect(qam.tabContainer.style.maxWidth).toBe("300px");
    expect(qamWideningStatus().applied).toBe(false);
  });
});

describe("QAM widening re-apply after Steam re-renders", () => {
  test("restores the root classes Steam's React drops on a tab change", async () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    // Steam re-renders the BasicUI className on active-tab changes, dropping
    // classes it did not set itself — exactly what the measurement observed.
    qam.root.className = "BasicUI_Container hashedSomethingElse";
    await settled();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
    expect(qam.tabContainer.style.maxWidth).toBe("none");
  });

  test("never re-applies after an intentional collapse", async () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    setQamWidening(false);
    qam.root.className = "BasicUI_Container";
    await settled();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
    expect(qam.tabContainer.style.maxWidth).toBe("");
  });
});

describe("QAM widening lifecycle", () => {
  test("does not re-apply over another QAM section (anchor hidden)", async () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    // Another QAM section becomes active: Steam drops the classes itself and
    // our content is hidden — the observer must not fight that.
    qam.root.className = "BasicUI_Container";
    (qam.anchor.parentElement as HTMLElement).style.display = "none";
    await settled();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
    expect(qam.tabContainer.style.maxWidth).toBe("");
  });

  test("detach keeps the widened DOM for a modal round-trip, re-attach re-derives", async () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    // A modal unmounts the panel (guide G4): detach disarms the observer but
    // must not collapse — the mode is still wanted.
    detachQamWidening();
    qam.root.className = "BasicUI_Container";
    await settled();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false); // nothing re-applied
    // Modal closed: the panel remounts with a NEW anchor element in the same
    // Steam tree; re-attach re-derives and re-arms the observer.
    const anchor2 = qam.anchor.ownerDocument.createElement("div");
    qam.anchor.replaceWith(anchor2);
    expect(attachQamWidening(anchor2)).toBe(true);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
    expect(qam.tabContainer.style.maxWidth).toBe("none");
    qam.root.className = "BasicUI_Container";
    await settled();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true); // observer armed again
  });

  test("a modal round trip that nests a copy of the root leaves nothing widened after the collapse", async () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    detachQamWidening();
    // DEVICE 2026-10-20: after a modal Steam renders the QAM content inside a
    // nested BasicUI whose className copies the outer root's — our classes
    // included — and drops it again when the QAM collapses.
    const doc = qam.anchor.ownerDocument;
    const nested = doc.createElement("div");
    nested.className = `BasicUI _nested ${qam.root.className}`;
    nested.append(...Array.from(qam.root.childNodes));
    qam.root.append(nested);
    const anchor2 = doc.createElement("div");
    qam.anchor.replaceWith(anchor2);
    expect(attachQamWidening(anchor2)).toBe(true);
    setQamWidening(false);
    await settled();
    expect(doc.querySelectorAll(`.QAMFriendExpanded, .${COMPANION}`).length).toBe(0);
    nested.replaceWith(...Array.from(nested.childNodes));
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
    expect(qam.root.classList.contains(COMPANION)).toBe(false);
  });

  test("an applied widening stops writing: its own class writes never re-trigger it", async () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    await settled();
    let writes = 0;
    const view = qam.anchor.ownerDocument.defaultView!;
    const watch = new view.MutationObserver((records) => {
      writes += records.length;
    });
    watch.observe(qam.root, { attributes: true, attributeFilter: ["class"] });
    await settled();
    await settled();
    watch.disconnect();
    expect(writes).toBe(0);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
  });

  test("stop reverts everything for plugin unload", () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    stopQamWidening();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
    expect(qam.tabContainer.style.maxWidth).toBe("");
    expect(qamWideningStatus()).toEqual({ available: false, applied: false });
    // Steam's DOM outlives a plugin reload: a stopped service stays inert.
    qam.root.className = "BasicUI_Container";
    setQamWidening(true);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
  });
});

describe("QAM widening follows the browse session state machine", () => {
  // The service owns the Steam DOM only; the machine owns the wanted mode
  // (UI-02 ticket 02). The wiring is subscribeWidening(setQamWidening) at the
  // service module's load, verified here through real machine transitions.
  // Module instances are shared across the test run, so the machine's wanted
  // mode is an accumulator: earlier machine tests (subscribe/unsubscribe) can
  // leave it wide. Every scenario starts from the machine's own reset plus a
  // defined wanted mode, never relying on file or listed order.
  beforeEach(async () => {
    const machine = await import("../browseSessionState");
    machine.resetBrowseSessionState();
    machine.widening.wide = false;
    machine.pageState.tab = "search";
  });

  test.each(["selection", "cancellation"])(
    "archive picker %s restores width, pane and focus",
    async (outcome) => {
      const machine = await import("../browseSessionState");
      const { fileImport, resetFileImport } = await import("../fileImportState");
      const { browseArchive } = await import("../archivePicker");
      const { rememberEngineHome } = await import("../pickerStart");
      rememberEngineHome("/home/sigurdb");
      const { rememberFocus, resetFocusMemory } = await import("../focusMemory");
      const qam = buildSteamQam();
      const native = nativePlaceholder(qam);
      const oldWindow = globalThis.window;
      const oldDocument = globalThis.document;
      globalThis.window = qam.anchor.ownerDocument.defaultView as unknown as Window &
        typeof globalThis;
      globalThis.document = qam.anchor.ownerDocument;
      const oldAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
      Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
        configurable: true,
        value: true,
      });
      let control = createRoot(qam.anchor);

      attachQamWidening(qam.anchor);
      machine.focusDestination("url");
      machine.enterBrowsePane();
      resetFocusMemory(() => 0);
      const view = machine.browseFocusView("url");
      rememberFocus(view, "file:browse");
      await act(async () => control.render(createElement(BrowseControl, { view })));
      const path = "/home/sigurdb/Downloads/nested/Foo.zip";
      const preview = {
        fileName: "Foo.zip",
        name: "Foo",
        author: "",
        version: "1",
        folders: ["Foo"],
        providerId: "File",
        externalId: path,
        match: { kind: "new" as const },
      };
      let pickerReturned = false;
      let finishPicker!: () => void;
      const pickerPending = new Promise<void>((resolve) => {
        finishPicker = resolve;
      });
      let browsing!: Promise<void>;
      try {
        await act(async () => {
          browsing = browseArchive(
            async (select, start, files, folders, filter, extensions, hidden, all) => {
              expect(select).toBe(0); // Steam FILE selection, folders navigate only.
              expect(start).toBe("/home/sigurdb"); // The engine's HOME (#133).
              expect(files).toBe(true);
              expect(folders).toBe(true);
              expect(filter).toBeUndefined();
              expect(extensions).toEqual(["zip", "rar", "7z"]);
              expect(hidden).toBe(false);
              expect(all).toBe(false);
              await pickerPending;
              pickerReturned = true;
              if (outcome === "cancellation") throw new Error("cancelled");
              return { path, realpath: path };
            },
            async (selected) => {
              expect(selected).toBe(path);
              return { result: preview, error: null };
            },
            view,
          );
        });
        machine.qamHidden();
        detachQamWidening();
        qam.root.className = "BasicUI";
        await act(async () => control.unmount());
        const replacement = qam.anchor.ownerDocument.createElement("div");
        qam.anchor.replaceWith(replacement);
        qam.anchor = replacement;
        machine.qamShown();
        attachQamWidening(replacement);
        expect(machine.enterBrowseSession()).toBe("pane");
        control = createRoot(replacement);
        await act(async () => control.render(createElement(BrowseControl, { view })));
        const disabledButton = replacement.querySelectorAll("button")[1]!;
        expect(disabledButton.disabled).toBe(true);
        expect(replacement.ownerDocument.activeElement).not.toBe(disabledButton);

        await act(async () => {
          finishPicker();
          await browsing;
        });
        expect(pickerReturned).toBe(true);
        const buttons = qam.anchor.querySelectorAll("button");
        const browse = buttons[1]!;
        expect(browse.disabled).toBe(false);
        // A preview card's Install takes focus so A installs (#128); a
        // cancelled pick keeps it on Browse….
        const focused = outcome === "selection" ? buttons[2]! : browse;
        expect(focused.textContent).toBe(outcome === "selection" ? "Install" : "Browse…");
        expect(focused.ownerDocument.activeElement).toBe(focused);
        native.expectUnclipped();
        expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
        expect(qam.tabContainer.style.maxWidth).toBe("none");
        expect(machine.pageState.tab).toBe("url");
        expect(fileImport.get()).toEqual(
          outcome === "selection"
            ? { phase: "ready", preview, error: null }
            : { phase: "idle", preview: null, error: null },
        );
      } finally {
        await act(async () => control.unmount());
        resetFileImport();
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
        if (oldAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", oldAct);
        else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
      }
    },
  );

  test("popup return restores the visible layout when content hides before detaching", async () => {
    const machine = await import("../browseSessionState");
    const qam = buildSteamQam();
    const native = nativePlaceholder(qam);
    attachQamWidening(qam.anchor);
    machine.focusDestination("url");
    machine.enterBrowsePane();
    for (let round = 0; round < 2; round++) {
      machine.popupOpening();
      machine.qamHidden();
      qam.tabContainer.style.display = "none";
      // A widening enforcement during Steam's hidden-content render. This is
      // the same public adapter entry used by its coalesced observer, without
      // depending on the observer timer's ordering against panel teardown.
      setQamWidening(true);
      expect(native.visibleWidth()).toBe(348);
      qam.tabContainer.style.display = "";
      machine.qamShown();
      native.expectUnclipped();
      expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
      expect(qam.tabContainer.style.maxWidth).toBe("none");
      detachQamWidening();
      const replacement = qam.anchor.ownerDocument.createElement("div");
      qam.anchor.replaceWith(replacement);
      qam.anchor = replacement;
      attachQamWidening(replacement);
      expect(machine.enterBrowseSession()).toBe("pane");
      expect(machine.pageState.tab).toBe("url");
      native.expectUnclipped();
    }
    machine.qamHidden();
    detachQamWidening();
    machine.qamShown();
    attachQamWidening(qam.anchor);
    expect(machine.enterBrowseSession()).toBeNull();
    expect(native.visibleWidth()).toBe(348);
  });

  test("a QAM close after the panel detached still drops the widened DOM (story 33)", async () => {
    const machine = await import("../browseSessionState");
    const qam = buildSteamQam();
    expect(attachQamWidening(qam.anchor)).toBe(true);
    machine.focusDestination("latest");
    // The QAM closed: the panel unmounted first (G4), and the close collapsed
    // the machine only after that — the service, detached but remembering the
    // elements it widened, must still leave nothing widened behind.
    detachQamWidening();
    machine.leaveBrowseSession();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
    expect(qam.tabContainer.style.maxWidth).toBe("");
    expect(qamWideningStatus().applied).toBe(false);
  });

  test("list entry widens, B up from the list slides it closed, via the machine", async () => {
    const machine = await import("../browseSessionState");
    const qam = buildSteamQam();
    expect(attachQamWidening(qam.anchor)).toBe(true);
    machine.focusDestination("latest");
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
    expect(qam.tabContainer.style.maxWidth).toBe("none");
    machine.popBrowseToNav();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
    expect(qam.tabContainer.style.maxWidth).toBe("");
  });

  test("re-entering the list with the mode already wanted still applies (Steam drop hazard)", async () => {
    const machine = await import("../browseSessionState");
    const qam = buildSteamQam();
    expect(attachQamWidening(qam.anchor)).toBe(true);
    machine.focusDestination("latest");
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
    // Steam re-renders the BasicUI className and silently drops our classes
    // while the mode stays wanted (ticket 06's domain); no machine transition
    // is needed — the observer's enforcement pass must restore them alone.
    qam.root.className = "BasicUI_Container";
    qam.tabContainer.style.maxWidth = "300px";
    await settled();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
    expect(qam.tabContainer.style.maxWidth).toBe("none");
  });
});

describe("QAM widening drives the native expand only when available", () => {
  test("expands and collapses with the DOM lever", () => {
    const qam = buildSteamQam();
    expect(attachQamWidening(qam.anchor)).toBe(true);
    setQamWidening(true);
    expect(expandCalls).toEqual([true]);
    setQamWidening(false);
    expect(expandCalls).toEqual([true, false]);
  });

  test("never expands when the widening CSS is unavailable", () => {
    const qam = buildSteamQam({ companionRule: null });
    expect(attachQamWidening(qam.anchor)).toBe(false);
    setQamWidening(true);
    expect(expandCalls).toEqual([]);
  });

  test("without an expander the mechanism is unavailable and nothing widens", () => {
    setQamExpander(null);
    const qam = buildSteamQam();
    expect(attachQamWidening(qam.anchor)).toBe(false);
    setQamWidening(true);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
  });

  test("an expander Steam's QAM does not render through leaves the page collapsed", () => {
    // The DroidDeck bug: the page went wide while the view never moved, so
    // the pane sat clipped off screen. Collapsed browse beats that.
    setQamExpander(recordingExpander(false));
    const qam = buildSteamQam();
    expect(attachQamWidening(qam.anchor)).toBe(false);
    setQamWidening(true);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
    expect(expandCalls).toEqual([]);
  });

  test("a throwing expander is swallowed to a warning", () => {
    setQamExpander({
      live: true,
      setExpanded: () => {
        throw new Error("view gone");
      },
    });
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
  });

  test("stop collapses for plugin unload, only if it expanded", () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    stopQamWidening();
    expect(expandCalls).toEqual([]); // never sent: nothing to take back
    setQamExpander(recordingExpander());
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    stopQamWidening();
    expect(expandCalls).toEqual([true, false]);
  });
});

describe("QAM collapse slides before the clip returns (PC-08)", () => {
  test("slides the native view first and keeps the widened page until the slide ends", async () => {
    const qam = buildSteamQam();
    const layout: boolean[] = [];
    const stopLayout = subscribeQamLayout((wide) => layout.push(wide));
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    setQamWidening(false);
    expect(expandCalls).toEqual([true, false]);
    // Mid-slide: only the clip stays widened under the moving view (Get
    // Addons' fixed pane follows the layout); content widths are given back,
    // so the tab bar, other tabs and Decky's plugin list never stretch.
    expect(qam.root.classList.contains(COMPANION)).toBe(true);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
    expect(qam.tabContainer.style.maxWidth).toBe("");
    expect(layout).toEqual([true]);
    await slid();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
    expect(qam.tabContainer.style.maxWidth).toBe("");
    expect(qamWideningStatus().applied).toBe(false);
    expect(layout).toEqual([true, false]);
    stopLayout();
  });

  test("holds the widened page through a QAM tab change while sliding", async () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    // L1/R1 to another QAM section: our content hides, Steam drops the classes.
    (qam.anchor.parentElement as HTMLElement).style.display = "none";
    qam.root.className = "BasicUI_Container";
    // One enforcement pass, well inside the hold that follows it.
    await new Promise((resolve) => setTimeout(resolve, WIDENING_REAPPLY_MS + 50));
    expect(expandCalls).toEqual([true, false]);
    // Steam dropped the classes: the clip is restored, content widths are not.
    expect(qam.root.classList.contains(COMPANION)).toBe(true);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
    expect(qam.tabContainer.style.maxWidth).toBe("");
    await slid();
    expect(qam.root.classList.contains(COMPANION)).toBe(false);
  });

  test("a widen during a running collapse cancels the pending revert", async () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    setQamWidening(false);
    setQamWidening(true);
    expect(expandCalls).toEqual([true, false, true]);
    await slid();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(true);
    expect(qam.tabContainer.style.maxWidth).toBe("none");
    setQamWidening(false);
    await slid();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
  });

  test("closing the QAM mid-slide leaves it collapsed for the next open", async () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    setQamWidening(false);
    detachQamWidening(); // the panel unmounts with the QAM
    await slid();
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
    expect(qamWideningStatus().applied).toBe(false);
    expect(expandCalls).toEqual([true, false]);
    // Reopen: the fresh panel attaches collapsed, nothing is re-widened.
    const anchor2 = qam.anchor.ownerDocument.createElement("div");
    qam.anchor.replaceWith(anchor2);
    expect(attachQamWidening(anchor2)).toBe(true);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
  });

  test("a QAM close while widened snaps the view (nothing is left to watch)", () => {
    const qam = buildSteamQam();
    attachQamWidening(qam.anchor);
    setQamWidening(true);
    detachQamWidening();
    setQamWidening(false);
    expect(expandCalls).toEqual([true, false]);
    expect(qam.root.classList.contains("QAMFriendExpanded")).toBe(false);
  });
});

describe("QAM widening transition table (enforceStep)", () => {
  const base = {
    bound: true,
    available: true,
    desiredWide: false,
    visible: true,
    applied: false,
    collapsing: false,
    nativeApplied: false,
  };
  const rows: [string, Partial<typeof base>, ReturnType<typeof enforceStep>][] = [
    ["wanted and showing: widen", { desiredWide: true }, "widen"],
    [
      "wanted and showing while a collapse slides: widen (takes it over)",
      { desiredWide: true, collapsing: true, applied: true },
      "widen",
    ],
    [
      "wanted but another QAM section shows: collapse the widened view",
      { desiredWide: true, visible: false, applied: true, nativeApplied: true },
      "collapse",
    ],
    ["wanted but hidden, never widened: revert", { desiredWide: true, visible: false }, "revert"],
    [
      "not wanted while the view is widened: collapse",
      { applied: true, nativeApplied: true },
      "collapse",
    ],
    [
      "not wanted while the slide back runs: hold the clip",
      { applied: true, collapsing: true },
      "hold",
    ],
    ["not wanted, slide done: revert", { applied: true }, "revert"],
    ["nothing wanted, nothing applied: revert (idempotent)", {}, "revert"],
    [
      "detached while wanted (modal round trip): keep",
      { bound: false, desiredWide: true, applied: true, nativeApplied: true },
      "none",
    ],
    [
      "detached after the mode ended (QAM closed): snap collapsed",
      { bound: false, applied: true, nativeApplied: true },
      "snapCollapse",
    ],
    ["detached, nothing applied: nothing", { bound: false }, "none"],
    [
      "no mechanism: native view off",
      { bound: false, available: false, desiredWide: true },
      "nativeOff",
    ],
    [
      "no mechanism but our classes linger and the mode ended: snap collapsed",
      { bound: false, available: false, applied: true },
      "snapCollapse",
    ],
  ];
  for (const [name, change, step] of rows) {
    test(name, () => {
      expect(enforceStep({ ...base, ...change })).toBe(step);
    });
  }
});
