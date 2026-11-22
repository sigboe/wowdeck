# Patch Steam's private Play button, fall back to Steam's plain one

Accepted 2026-11-18. Reworks the separate launch control of PR #284 (#285).

Players choose which WoW client a linked Battle.net shortcut starts. PR
#284 put that choice in a second button and chevron beside Steam's Play.
The page then had two ways to start the game, and they looked and behaved
differently. Steam already has a place for this choice: the chevron beside
Play opens a "Play from…" menu, and choosing a stream target relabels
Play. WoWDeck now puts its choice there.

Steam draws Play, the chevron and the menu in one class component that its
module doesn't export. The module does export a wrapper (a `forwardRef`
that adds `navigator` and `instance` props) whose render returns the
class's element. WoWDeck:

- patches the wrapper's render. When the element it returns is a class
  with `ShowStreamingMenu` and `GetTextForRemoteClientAction` on its
  prototype, WoWDeck hooks that class and gives the element its own key;
- wraps each instance's render as it first renders. Steam's class is a
  mobx observer: on an instance's first render it locks that instance's
  own `render` (non-writable, non-configurable), so nothing can wrap it
  afterwards. The hook replaces the prototype's render and, for that one
  call, catches mobx defining the instance's render and wraps it. A
  button that rendered before the hook (the plugin loaded with the page
  open) remounts through the new key when the addon section re-renders
  the component above it;
- on a linked page with launch state, transforms the instance's render
  output: the chevron always shows, the selected target's icon replaces
  the play glyph, and its short name goes in the line Steam uses for the
  streaming PC's name. Steam's labels stay while WoW runs, while a stream
  target is selected, and while Battle.net is the target and already open,
  where Steam's Resume brings it forward. Battle.net open with a WoW client
  chosen still shows the client under "Play", and Play starts it;
- opens the menu through Steam's own `ShowStreamingMenu`. For that one
  synchronous call it intercepts the jsx runtime and wraps the menu
  element (the one with `onStreamingTargetSelected`) in WoWDeck's menu.
  That menu renders Steam's and replaces only the local row ("Play on
  this Steam Deck") with Battle.net and the WoW clients. Steam's stream
  rows stay as Steam built them.

The two transforms are pure functions over render trees
(`src/steamPlayButton.ts`). Their tests use trees shaped like the Deck's.

## Fallback

The source this relies on is Steam's minified UI, read on 2026-11-18.
`docs/ui/device-notes.md` §8.4e lists each property, whether it was
observed on the Deck or only read from the source, and what happens
without it. A
Steam update can rename, reshape or stop exporting any of it. Every step
checks what it finds. If the wrapper, the class, the CSS module, the
render shape or the menu shape doesn't match, WoWDeck does nothing for
that step and logs one warning per session. Steam's plain Play button and
its own menu stay usable. If the jsx runtime can't be intercepted, Steam's
unchanged menu opens. If an instance's `render` can't be replaced, that
button stays Steam's.

## Off switch

Options → Steam library has **Choose the WoW version from Play**, on by
default (#286). While it is off, WoWDeck installs none of the above: no
wrapper patch, no class hook, no jsx runtime swap. Steam's plain Play
button and its own "Play from…" menu work as they did before #284. The
WoW addons section stays on the page but reads no launch state and shows
no launch lines. A change applies to an open game page at once: turning
the option on remounts Play through the patch by its key, and turning it
off disposes the patch and remounts Steam's own. Each shortcut's saved
launch target stays, so turning it back on restores the player's pick.

The checks above catch the Steam changes we can foresee. When one slips
past them, or a player wants Steam's own Play button, turning the option
off brings that button back. Unlinking the game would do it too, but it
also removes the addons section.

## Revised 2026-11-21: Play is left to DroidDeck

On DroidDeck, WoWDeck doesn't patch Play (#296). DroidDeck adds one Steam
game per WoW version, and its Proton wrapper replaces Steam's start of a
Battle.net game with its own store launcher. The store launcher runs
DroidDeck's Battle.net driver, `droiddeck-battlenet`, which waits for
Battle.net and asks it for the game's own version up to three times, 15
seconds apart. DroidDeck has no setting, flag or hook that stops the ask. Picking another version in
WoWDeck's menu would send a second ask that races DroidDeck's, and the
picker wouldn't do what it says.

The engine checks once at startup whether
`/usr/local/bin/droiddeck-store-launch` exists and is executable. When it
does, every `launch.*` method answers as for a page with no launch state,
so the page keeps Steam's own Play button and "Play from…" menu, as with
the off switch. The linked games answer names DroidDeck as the owner of
Play. **Play starts WoW** and the saved launch targets stay untouched.
[Steam game page launch targets](../steam-launch-targets.md#droiddeck)
has the details.

If DroidDeck later offers a supported way to open Battle.net without the
ask, a follow-up can turn the patch back on through it.

## Consequences

- Each Steam client update needs a Deck check of the Play button (the
  regression plan's Steam library rows).
- A patched render reads its state from WoWDeck's module-scope stores and
  runs no hooks inside Steam's class.
- Steam moves focus inside the menu, because the rows are Steam menu
  items.
