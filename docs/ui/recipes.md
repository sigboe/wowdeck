# Recipes

Part of the [UI guide](README.md). README.md explains the rule markers (MUST, SHOULD, [GENERAL], [PROJECT]) and the evidence tags (OFFICIAL, LIVE, DEVICE, …).

R1–R9: how to build the patterns the S rules ask for.

## Contents

- [5.4 How to build it (recipes)](#54-how-to-build-it-recipes)

## 5.4 How to build it (recipes)

Copy these; each is the working pattern behind a rule. Names are real.

**R1 — A QAM row that keeps its place (S21).**

```tsx
// A row that is itself focusable (Field, DialogButton): spread focusTarget.
<Field focusable label="Find WoW installations" onClick={detect}
  {...focusTarget(QAM_VIEW.settings, "detect")} />
// A control that takes no such props (TextField, DropdownItem, ToggleField):
<FocusRow view={QAM_VIEW.settings} id="gameVersion">
  <DropdownItem label="Game version" rgOptions={…} selectedOption={…} onChange={…} />
</FocusRow>
// The view: restore the last row on mount (or as soon as it loads).
useRestoreFocus(QAM_VIEW.settings, restoreRows);
// After a picker/modal returns, decide where focus goes next:
requestFocus(QAM_VIEW.settings, picked ? "displayName" : "browse");
```

Keys must be stable (an id, not an index). Every focusable QAM row gets one.

**R2 — A view that scrolls like Valve's (S21).**

```tsx
// QAM root (index.tsx): measure, attach and carry Steam's NoTransform type.
const rootRef = useRef<HTMLDivElement>(null);
const remeasure = useScrollBuffer(rootRef, { attach: true });
<Focusable ref={rootRef} className="wowdeck-root wowdeck-scroll-buffer"
  onGamepadFocus={remeasure} {...STEAM_NO_TRANSFORM_SCROLL}>…</Focusable>
// A modal or a page tab: the component does all of it.
<DialogBody><style>{wowupModalStyleCss()}</style><ScrollBuffer>…rows…</ScrollBuffer></DialogBody>
```

Needs `SCROLL_BUFFER_CSS` in the document (panel CSS, `wowupModalStyleCss()`,
`PAGE_CSS`). Do not put an `overflow: auto` box that does not scroll (Steam's
`DialogBody` inside a page) between the rows and the real scroller; the hook
carries the margin through one, but avoid it. Verify with
`tools/deck-ui/step.mjs` going up and down: the row must stop on the same line
and every further press must scroll one row.

**R3 — A floating pane in the QAM (S24, S25).**

```tsx
<div className="wowdeck-float-pane">
  <TopNav … />
  {viewWideControl /* e.g. the installation picker on My Addons */}
</div>
```

The pane sticks under Decky's title (`--wowdeck-pane-top`), stacks above it
(`--wowdeck-pane-z`), keeps Valve's 16 px (`--wowdeck-attach-gap`) and ends in the
scroll fade (`::after`, shown only once scrolled), all measured by
`useScrollBuffer({ attach: true })` on the root. Never hard-code another
component's height or z-index.

**R4 — A full-screen page (S18, S26).**

```tsx
<Focusable style={{ marginTop: "var(--basicui-header-height, 40px)",
    height: "calc(100% - var(--basicui-header-height, 40px))" }}
  {...STEAM_NO_TRANSFORM_SCROLL}
  onOptionsButton={…} onOptionsActionDescription="Category">
  <style>{PAGE_CSS}</style>
  <Tabs activeTab={active} onShowTab={…} tabs={sameTabsEveryTime}
    belowHeaderTabsContent={<Focusable className="wowdeck-page-bar" onButtonDown={bumpers}>…</Focusable>}
    onCancelFromTabHeader={leaveToQam} />
</Focusable>
// each tab: <ScrollBuffer overlays={pageHeaderOverlay} reserveOverlap>…</ScrollBuffer> (no DialogBody)
// leave: OpenQuickAccessMenu(QuickAccessTab.Decky); setTimeout(NavigateBack, QAM_SLIDE_IN_MS)
```

**R5 — A modal.** `ModalRoot` + `DialogHeader` + `DialogBody` (+ `R2`'s
`ScrollBuffer`) + `DialogFooter` with `DialogTwoColLayout` (action first,
Cancel second). Rows are `Field focusable` with footer labels (S14).

**R6 — A controller glyph.** `<SteamGlyph button="LeftBumper" fallback="L1" />`
(Steam's own component; shows the glyph of the controller or keyboard in use).

**R8 — Audit a view against the guidelines.** With the CDP tunnel up:

```sh
node tools/deck-ui/audit-view.mjs QuickAccess_uid      # every row on screen: INSET, TOUCH, SMALL_TEXT, CLIPPED
node tools/deck-ui/walk.mjs QuickAccess_uid tools/deck-ui/audit-focus.js ArrowDown ArrowDown …
                                                        # what really lights up at each focus, and its insets
```

`audit-view` measures statically (no input); `audit-focus` follows real focus,
including rows that light up on focus-within. Run both on every view: each
QAM tab, each page tab, each modal (open with a harmless click, close with
Escape = B). Calibrate on Steam's own page first (`audit-focus` with the
`ours` check removed): Valve's rows pass, so a flag on ours is ours.

**R9 — A warning on a card (S38).**

```tsx
import { Warning, WarningLine } from "./Warning";
// In a Field's description, after the line that describes the item:
<Warning heading="This replaces RestedXP from CurseForge">
  <WarningLine text="RestedXP will stop updating from CurseForge" />
</Warning>
// On a conflict card, the heading says how many addons match and the line under it gives the fix.
<Warning heading="This file matches 2 installed addons">
  <WarningLine text="Remove one, and the file will update the other" />
</Warning>
// Its rows, one per addon with its folders one level in, each have a Remove
// button, so they go in the Field's children above Install. A description
// can't hold a focus target.
<Focusable flow-children="column">
  <div>
    <div>RestedXP Guide</div>
    <WarningLine text="Uses RestedXP, RestedXP_Data" level={1} />
  </div>
  <FocusSlot view={view} id={FILE_FOCUS.conflictRemove(addonId)}>
    <DialogButton>Remove</DialogButton>
  </FocusSlot>
  …
</Focusable>
```

Build the words in a pure, tested function next to the flow's state, such
as `takeoverWarning` and `conflictWarning` in `fileImportState.ts`, and
keep the component for layout only. One-line texts take no period (C03).

**R7 — Find out how Valve does it.**

1. Search Steam's own code on the Deck: `~/.local/share/Steam/steamui/sp.js`
   and `css/sp.css`. Map a hashed class to its name with
   `grep -o '[A-Za-z]*:"<hash>"' sp.js`; read its rules in `sp.css`. Look for
   the component's props (e.g. `scrollIntoViewType`, `canBeHeaderBackground`,
   `wrapAround`) where Steam uses them.
2. Measure the real thing (`tools/deck-ui/eval.mjs`): computed styles, sizes,
   which element scrolls, `scroll-padding`/`scroll-margin`, shadows, z-index.
3. Watch behaviour: `step.mjs` for per-press scrolling, `film.mjs` for
   animations and stalls, `profile.mjs` for where time goes, `shot.mjs` to see.
4. Try the fix in memory on the device before coding it, then record the
   finding in this guide with the method (DEVICE, date).
