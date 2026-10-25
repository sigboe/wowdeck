# Deck Debug settings

`defsettings.json` holds the SSH target and plugin name used by the
[Deck Debug](https://marketplace.visualstudio.com/items?itemName=SteamDeckHomebrew.deck-debug)
VS Code extension. We keep it as a tracked reference, not as editor config:
`deckip` is the upstream template's `steamdeck.local` placeholder, so set your
own Deck's address when you use it.

To use it, copy it into your editor's local config (VS Code reads
`.vscode/defsettings.json`, which is not tracked here):

```bash
mkdir -p .vscode && cp deck-debug/defsettings.json .vscode/defsettings.json
```
