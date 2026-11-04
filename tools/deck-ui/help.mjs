// node help.mjs  - the command list, compact enough to read instead of README.md
console.log(`deck-ui scripts (tunnel: -L 18080:localhost:8080; target = title substring)
deck <step> | deck run '<step>; …' | deck up | deck down   start here: deploy, drive, probe, rpc, shot (deck help)
state.mjs [--pages]                      one line: pages, route, plugin, qam, focus, view
seek.mjs <target> <label> [--press|--list|--enter|--reset]  focus the element now (jump), or --press step to it; --reset opens the panel
tree.mjs <target> [--roles=a,b] [--max=N]  accessibility tree, role:name per node
eval.mjs <target> <expr|file.js> [-p]    evaluate JS; strings print raw, -p indents
walk.mjs <target> <measure.js> [--diff] <keys…>  press each key, print the measurement
step.mjs <target> <ArrowUp|ArrowDown> <n> <ms> <measure.js> [--diff]
key.mjs <target> <ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Escape> [n] [ms]
pad.sh <button…>                         real pad: a b x y lb rb lt rt view menu guide l3 r3 up down left right
shot.mjs <target> <out.png> [--timeout=ms]  screenshot, prints path and bytes (10 s cap)
audit-view.mjs <target> [--brief]        guideline audit: OVERFLOW, INSET, TOUCH, SMALL_TEXT, CLIPPED
audit-focus.js                           same audit at the current focus (for walk/step measure files)
film.mjs <target> <ms> <outDir> [trg trg.js]   every frame while a trigger runs
profile.mjs <target> <ms> <trigger.js> <out.json>  CPU profile, top functions
capture.mjs [--start a] [--stop b] [--tail n] [--film t…] [--out d]  events between two owner presses
render.mjs <Component> '<props JSON>' [out.png]  render one @decky/ui component in our panel, audit, remove
enter-if.mjs <target> <css>              Enter only if the focused element matches
pad.sh and deck up/press read DECK from the environment or local.env; the rest use the tunnel only
Common: shared nav moves live in SharedJSContext (window.DFL.Navigation): OpenQuickAccessMenu(999), CloseSideMenus(), Navigate('/wowdeck/get-addons'); DeckyPluginLoader.deckyState.setActivePlugin('WoWDeck')`);
