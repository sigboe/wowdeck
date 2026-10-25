#!/usr/bin/env python3
"""Print the CSS Steam itself applies to a named UI class, from a copy of its UI files.

Steam's gamepad UI uses CSS modules: class names are hashed per build, so the
stylesheet alone says nothing. The name-to-hash map is plain data in the client's
JS and can be read (not run) over Decky's CDP port. This tool joins the two so a
spacing or colour in the UI guide can be re-checked after a SteamOS update.

Read-only on the Deck; nothing here runs on it. See docs/UI_DEVELOPMENT_BEST_PRACTICES.md
section 5.3 for the full procedure.

  1. scp -r deck@<ip>:.local/share/Steam/steamui/css <dir>/css
  2. ssh -L 18080:localhost:8080 deck@<ip>, then, in SharedJSContext, read the source
     text of the webpack module whose source contains both "FieldLabel" and
     "FieldChildren" (req.m[id].toString(), do NOT call the module) and save the
     object literal as <dir>/classmap.js
  3. python3 tools/steamui_rules.py <dir>/css/sp.css <dir>/classmap.js Field StandardPadding
"""
import re
import sys
from pathlib import Path


def split_rules(css: str):
    i, n = 0, len(css)
    while i < n:
        j = css.find("{", i)
        if j < 0:
            return
        depth, k = 1, j + 1
        while k < n and depth:
            depth += {"{": 1, "}": -1}.get(css[k], 0)
            k += 1
        yield css[i:j].strip(), css[j + 1 : k - 1]
        i = k


def flat_rules(css: str):
    for sel, body in split_rules(css):
        if sel.startswith(("@media", "@supports")):
            for s2, b2 in split_rules(body):
                yield f"{sel} >> {s2}", b2
        elif not sel.startswith("@"):
            yield sel, body


def main(argv: list[str]) -> int:
    if len(argv) < 4:
        print(__doc__)
        return 2
    css = Path(argv[1]).read_text(encoding="utf-8", errors="replace")
    classmap = dict(
        re.findall(r'(?:^|[,{])"?([A-Za-z_][\w-]*)"?:"([^"]+)"', Path(argv[2]).read_text())
    )
    rules = list(flat_rules(css))
    for name in argv[3:]:
        hashed = classmap.get(name)
        if not hashed:
            print(f"## {name}: not in class map")
            continue
        print(f"## {name} = {hashed}")
        pat = re.compile(r"\." + re.escape(hashed) + r"(?![\w-])")
        for sel, body in rules:
            if pat.search(sel):
                print(f"  {sel[:200]} {{{body[:400]}}}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
