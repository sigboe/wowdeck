#!/usr/bin/env python3
"""Measure our UI markup's geometry under Steam's real CSS, in headless Chromium.

Component tests render Steam components as stubs, so they cannot catch spacing
or alignment bugs: a chevron 20 px off center passes every one of them. This
tool loads a captured copy of Steam's stylesheets (sp.css, library.css) plus a
class-name map — the same inputs `tools/steamui_rules.py` joins — renders a
page of our markup with those classes applied, runs measurement JavaScript and
checks each value against min/max bounds. Output is numbers, not screenshots,
so it is cheap to run in a loop while fixing layout.

It is a pre-check, not a proof: host Chromium is not the Deck's CEF, fonts and
text wrapping differ, and there is no gamepad focus. Hardware verification
(`.claude/skills/deck-test`) stays the authority.

Usage:
  python3 tools/steamui_layout_check.py <capture_dir> <spec_dir> [--chromium BIN]

<capture_dir> layout (see docs/UI_DEVELOPMENT_BEST_PRACTICES.md §5.3):
  css/sp.css, css/library.css   captured from the Deck (read-only scp)
  classmap.js                   semantic -> hashed class names, read over CDP

<spec_dir> layout:
  page.html   markup under test; `data-class="Field StandardPadding"` resolves
              each name through classmap.js into Steam's hashed classes
  check.js    defines window.__layoutCheck = () => [{name, value, min, max}, ...]
  spec.json   optional: {"widths": [268, 576]} (default [268])

Chromium is found via --chromium, $CHROMIUM_BIN, PATH, or
`nix shell nixpkgs#chromium` as a last resort.
"""

import argparse
import html as html_mod
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

RESULTS_ID = "__layout_results"


def parse_classmap(text: str) -> dict[str, str]:
    # Same join steamui_rules.py uses: the map is a plain object literal.
    return dict(re.findall(r'(?:^|[,{])"?([A-Za-z_][\w-]*)"?:"([^"]+)"', text))


def resolve_classes(html: str, classmap: dict[str, str]) -> tuple[str, list[str]]:
    """Replace data-class="A B" with the hashed classes; report unknown names."""
    missing: list[str] = []

    def sub(m: re.Match) -> str:
        hashed: list[str] = []
        for name in m.group(1).split():
            h = classmap.get(name)
            if h is None:
                missing.append(name)
            else:
                hashed.append(h)
        return 'class="' + " ".join(hashed) + '"'

    return re.sub(r'data-class="([^"]+)"', sub, html), missing


def find_chromium(flag_bin: str | None) -> str:
    candidates = [flag_bin, os.environ.get("CHROMIUM_BIN"), shutil.which("chromium")]
    for c in candidates:
        if c and (Path(c).exists() or shutil.which(c)):
            return c
    return "nix shell nixpkgs#chromium -c chromium"


def run_chromium(bin_cmd: str, url: str, width: int) -> str:
    argv = bin_cmd.split() if " " in bin_cmd else [bin_cmd]
    argv += [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--allow-file-access-from-files",
        f"--window-size={width},800",
        "--virtual-time-budget=3000",
        "--dump-dom",
        url,
    ]
    return subprocess.run(argv, capture_output=True, text=True, check=True, timeout=120).stdout


def extract_results(dom: str) -> list[dict]:
    m = re.search(
        r'<pre id="' + RESULTS_ID + r'"[^>]*>(.*?)</pre>', dom, re.DOTALL
    )
    if not m:
        raise RuntimeError(
            f"no <pre id={RESULTS_ID!r}> in output; check.js may have thrown"
        )
    data = json.loads(html_mod.unescape(m.group(1)))
    return data if isinstance(data, list) else [data]


def evaluate(checks: list[dict]) -> list[tuple[str, float, str]]:
    rows = []
    for c in checks:
        name, value = c["name"], float(c["value"])
        ok = float(c.get("min", "-inf")) <= value <= float(c.get("max", "inf"))
        rows.append((name, value, "ok" if ok else "FAIL"))
    return rows


def build_page(spec_dir: Path, capture_dir: Path, classmap: dict[str, str]) -> str:
    page = (spec_dir / "page.html").read_text(encoding="utf-8")
    page, missing = resolve_classes(page, classmap)
    if missing:
        raise RuntimeError(
            "classmap.js has no entry for: " + ", ".join(sorted(set(missing)))
        )
    check_js = (spec_dir / "check.js").read_text(encoding="utf-8")
    links = "".join(
        f'<link rel="stylesheet" href="{css.as_uri()}">'
        for css in sorted((capture_dir / "css").glob("*.css"))
    )
    runner = (
        f"<pre id='{RESULTS_ID}'></pre><script>{check_js}</script>"
        "<script>window.addEventListener('load',function(){"
        f"try{{document.getElementById('{RESULTS_ID}').textContent="
        "JSON.stringify(window.__layoutCheck());}"
        f"catch(e){{document.getElementById('{RESULTS_ID}').textContent="
        f"JSON.stringify({{error:String(e)}});}}}});</script>"
    )
    if "</body>" in page:
        return page.replace("</body>", links + runner + "</body>")
    return page + links + runner


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("capture_dir", type=Path)
    ap.add_argument("spec_dir", type=Path)
    ap.add_argument("--chromium")
    args = ap.parse_args(argv)

    args.capture_dir = args.capture_dir.resolve()
    args.spec_dir = args.spec_dir.resolve()
    classmap_path = args.capture_dir / "classmap.js"
    if not classmap_path.exists():
        print(
            f"error: {classmap_path} missing; capture it per "
            "docs/UI_DEVELOPMENT_BEST_PRACTICES.md §5.3 (read-only over CDP)",
            file=sys.stderr,
        )
        return 2
    classmap = parse_classmap(classmap_path.read_text(encoding="utf-8"))
    if not classmap:
        print(f"error: no name:hash pairs found in {classmap_path}", file=sys.stderr)
        return 2

    spec_json = args.spec_dir / "spec.json"
    widths = [268]
    if spec_json.exists():
        widths = json.loads(spec_json.read_text()).get("widths", widths)

    full_page = build_page(args.spec_dir, args.capture_dir, classmap)
    bin_cmd = find_chromium(args.chromium)

    failures = 0
    with tempfile.TemporaryDirectory(prefix="steamui-layout-") as tmp:
        page_path = Path(tmp) / "page.html"
        page_path.write_text(full_page, encoding="utf-8")
        for width in widths:
            dom = run_chromium(bin_cmd, page_path.as_uri(), width)
            checks = extract_results(dom)
            print(f"## width {width} px")
            if len(checks) == 1 and "error" in checks[0]:
                print(f"  check.js error: {checks[0]['error']}")
                return 1
            for name, value, status in evaluate(checks):
                mark = "ok" if status == "ok" else "FAIL"
                print(f"  {mark}  {name}: {value:g}")
                failures += status == "FAIL"
    if failures:
        print(f"{failures} check(s) failed", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
