# Steam's bars over the widened pane, and the on-screen keyboard

DEVICE 2026-11-14, branch `fix/top-bar-keyboard-short-link`. This run checked
two fixes on the Deck. The widened Get Addons pane keeps clear of Steam's
bars while a game runs, and Enter on the on-screen keyboard closes the
keyboard after a search or a link lookup.

## Build and setup

- Deployed with `deck up`: frontend and engine 1.2.0 from this branch. The
  build stays installed.
- Display: the 1080p TV, not handheld. Screen 1500×843 CSS px at dpr 1.28.
- Game: Tower Wizard (3372980), started and quit through `SteamClient.Apps`
  with the owner's approval for this run. Revolution Idle wouldn't start
  without an update, and the run didn't download one.
- Fixture installation: Forever, nine addons. The run only searched and
  tried one bad link. It installed and removed nothing.

## What Steam does in-game

| | No game | Game running |
| --- | --- | --- |
| Main window `--basicui-header-height` | 40px | 0px |
| QAM placeholder | top 40, 854 × 764.55 | top 0, 854 × 844.5 |
| QAM window `innerHeight` | 766 | 845 |
| Status bar inside the QAM window | none | top 0, 40 px, z-index 6000, see-through |
| Button bar inside the QAM window | none | top 803.6, 41.7 px, z-index 7000 |

Steam starts its own QAM content under the status bar in both states, so
the bar never covered the collapsed panel. The widened pane is
`position: fixed` and was pinned at `top: 0; bottom: 0`. In-game, the
status bar covered its Category row and the button bar covered its last
row.

## Claims

| Claim | Result | Evidence and method |
| --- | --- | --- |
| Before the fix, in-game, the bars cover the pane | reproduced | A screenshot of the QAM window shows the clock and icons over the Category label and the last result row under the button bar. |
| In-game, the pane starts under the status bar and ends above the button bar | passed | CDP read `.wowdeck-pane-slot` as `top: 40px`, `bottom: 41px`. The screenshot shows the Category row clear of the bar. |
| No game, the pane is unchanged | passed | CDP read `top: 0px`, `bottom: 0px` with `innerHeight` 766. The screenshot matches the earlier no-game layout. |
| Enter on the on-screen keyboard runs Search and closes the keyboard | passed | A real A press opened the keyboard (nav tree "virtual keyboard"). The run sent the keys "dbm" and Enter through Steam's `VirtualKeyboardManager.HandleVirtualKeyDown`, the path a key tap takes. Afterwards `IsShowingVirtualKeyboard` was false, the nav tree was back to `QuickAccess-NA`, and the results showed. |
| Enter on Manual Install's link field runs Look up and closes the keyboard | passed | Same method. The inline error showed and the keyboard closed. |
| Enter in Filter My Addons closes the keyboard | not tested | The modal's apply calls the same helper, and the modal closes on apply anyway. |
| Quitting the game while the pane is open re-measures | not reachable | Quitting closes the QAM, so the pane measures again on the next open. The resize listener stays for a game that starts while the QAM is open. |
