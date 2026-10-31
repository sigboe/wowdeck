# Get Addons moves into a widened QAM (Steam Friends pattern)

Get Addons needs a wide browse surface beside the QAM's own navigation.
Instead of keeping the full-screen route (stable, public Decky API) we move it
into the QAM tab and widen the QAM itself the way Steam's own Friends & Chat
tab does: toggling Steam-internal root classes and lifting our tab container's
300 px cap from inside the plugin (proven on-device 2026-10-18, see the QAM
widening measurements in the UI guide). Chosen because it is the interaction
the owner set as the design target — in-context, official-looking, with the
slide-out animation — at the cost of relying on Steam's internal CSS: hashed
class names can change on any Steam update, so selection is defensive and the
feature degrades silently to the collapsed 300 px layout when it breaks. The
`/wowdeck/get-addons` full-screen route and its drill-in rows are removed;
UI-guide rules G11/S18 are superseded for Get Addons when this ships. Focus
memory gains one deliberate exception: entering Get Addons always lands
collapsed on the plugin-tab nav bar. That exception has its own exception
(PC-09, owner 2026-10-20): closing the details carousel, or a menu, opened
from the widened pane is not an entry. The user never left the widened QAM, so
focus returns to the row it was on (`enterBrowseSession` returns true when the
remount finds the session still widened with focus in the pane).

**Revision 2 (2026-10-19, after the owner's device test).** Rev 1 mapped the
content the wrong way: it put the browse lists in the collapsed column and a
detail pane in the slid-out panel. The owner's intent is the Friends & Chat
mapping: the collapsed column is a vertical **destination list** (Search,
Latest, Popular, From URL) in the friends-list visual language; moving focus
onto a destination slides the QAM out and the slid-out panel is that
destination's **browse UI** (the "chat" of the analogy). Addon details keep
the existing details modal — there is no detail pane, no identity strip, no
action row, and no per-row focus memory beyond the destination selection. The
widening mechanism, service, observer and fallback from rev 1 are unchanged
and remain the reason this ADR exists; only the content mapping and the chrome
correction (keep Decky's title bar and back button, style the existing title)
changed.

**Revision 3 (2026-10-19, second device test).** Rev 1/2 assumed the widen was
Steam's internal QAM-window classes alone. The device proved otherwise: those
classes only lift inner caps, while the VISIBLE width is the Big Picture
window's native QAM BrowserView bounds (`BrowserView.SetBounds`; collapsed
x = innerWidth − 348). The QAM window cannot reach that view, so the service now
drives a second, native lever: it asks Decky to run a small script in the Big
Picture tab (`@decky/api executeInTab`, loader route `utilities/execute_in_tab`,
exact title `Steam Big Picture Mode`) that finds the QAM placeholder
(`#MainNavMenu-Rest`, React fiber `browser` prop) and calls `SetBounds`. Both
levers live in `src/steamDom/qamWidening.ts`, both driven by the same `widening` state in
`browseSessionState.ts`; the native lever is applied only while the CSS lever is
available, so an unrecognised Steam build still degrades to the collapsed
layout. See the QAM widening measurements in the UI guide.

**Revision 4 (2026-10-19, third device test).** A direct `SetBounds` snaps; the
owner saw the QAM extend instantly while Friends slides. The native script now
tweens x over 0.5 s with `requestAnimationFrame` (ease-out), cancelling any
in-flight tween and starting from the current bounds; collapsing still snaps
because the QAM page restores its 348 px clip in the same frame. The pane slot
no longer animates its own width: it snaps to `calc(100vw − 348px)` so the
already-full-width content is revealed by the native slide instead of
reflowing (text re-wrapped and rows moved while the container grew). The widen
classes, observer and fallback are unchanged.

**Revision 5 (2026-10-20, PC-08).** Collapsing slides too. Only the ordering
changed: the native view slides back first (same 0.5 s ease-out tween; Valve's
Friends close is still to be measured on the Deck), and the QAM page keeps
only its widened clip (the companion class) until the slide has ended, so no
empty strip shows behind the moving edge. The readable class and our cap lift
are dropped at once: held through the slide, they stretched whatever rendered
meanwhile (our tab bar, My Addons, Options, Decky's plugin list). Get Addons draws its widened layout from the service's applied DOM
(`subscribeQamLayout`), not from the wanted mode, so the pane stays beside the
list while it slides away. A widen during the collapse cancels the pending
revert and the tween takes over from the current bounds; a QAM close drops the
hold (the native slide lands by itself, with a timer fallback for throttled
frames); reduced motion still snaps.

**Revision 6 (2026-10-21, native expand).** The native lever no longer moves
the view itself. Steam's Friends UI store has the flag Friends & Chat widens
with (`SetQAMFriendsChatExpanded`, read as `qamFriendsExpanded`): while it is
set, Steam's own placeholder hook keeps the QAM BrowserView widened and
animates it with Valve's slides (300 ms out, 200 ms back). The service sets and
clears that flag, so every re-layout Steam does by itself keeps the QAM wide
too. Before, the on-screen keyboard and a closing modal snapped the view back
to its collapsed x and our script slid it out again. The `executeInTab`
script, its tween, the modal settle hook (PC-09) and the keyboard resize watch
are gone. The collapse hold (PC-08) stays, timed to Steam's 200 ms. Lever 1
(the QAM-window classes and our cap lift) is unchanged: in Big Picture Steam
does not add those classes for us. Without the store the mechanism is
unavailable and Get Addons stays collapsed, like a missing widening CSS.
DEVICE 2026-10-21 (Deck screen; recordings with `tools/deck-ui/capture.mjs`):
keyboard open/close kept x 0 with only the height changing, like Friends; the
Details modal round trip slid back to x 0 by Steam alone; collapse slid
0 → 506 in 200 ms under the held pane; a QAM close cleared the flag.

**Revision 7 (2026-10-31, the placeholder's own class).** Newer Steam honours
the Friends flag only while the Friends tab is active: Steam's QAM renderer
reads `qamFriendsExpanded && activeTab == Friends`. On the arm64 Steam client
under DroidDeck the flag was set, the page went wide, and the view never
moved, so the pane sat clipped off screen. The flag itself was never the
lever, though. The lever is the `Expanded` class on the QAM view's
placeholder: the placeholder measures its own box on every render and calls
`SetBounds` to match, with Steam's slides. So the plugin now gives the
placeholder that class itself. `QamExpandHook` patches the QAM renderer the
way Decky's TabsHook does (found by name, `afterPatch` on `type`, the mounted
fiber pointed at the patched type) and wraps the placeholder in a component
that adds `Expanded`, read from Steam's CSS module by its readable key, while
widened mode is on. The plugin no longer touches Friends' state. Steam still
adds its own classes next to ours, so the keyboard and modals keep the QAM
wide as before. The mechanism counts as available only while a wrapped placeholder is
mounted: a Steam build that renders the QAM differently leaves Get Addons
collapsed instead of half-widened. DEVICE 2026-10-31 (DroidDeck 0.6.7, Galaxy
S25, CDP and a virtual pad): focus slid the view from x 715 to 209, a dropdown and the
keyboard kept it there (`OSKActive` beside `Expanded`), R1 and a QAM close
collapsed it with nothing left behind, and a plugin reload while wide
collapsed and re-patched with a single wrapper. A reload with the QAM open
leaves Steam's rendered QAM alone until Steam renders it again, so the
wrapper the previous load mounted stays on screen. The expand state is
therefore kept once per Steam session, not per plugin load, so that wrapper
follows the new load. DEVICE 2026-10-31 on the Deck (SteamOS 3.9.5) and on
DroidDeck 0.6.9: before the fix, the next focus after a reload stayed
collapsed until the QAM closed; after it, focus widens again at once.
