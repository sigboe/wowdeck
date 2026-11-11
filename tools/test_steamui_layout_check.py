#!/usr/bin/env python3
"""Unit tests for tools/steamui_layout_check.py.

Deterministic: Chromium is faked with a script that prints a canned DOM; no
network, no browser, no wall clock.
"""

import json
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import steamui_layout_check as slc  # noqa: E402

CLASSMAP = 'var e={Field:"aB1",StandardPadding:"cD2",FieldLabel:"eF3"};'


def test_parse_classmap():
    assert slc.parse_classmap(CLASSMAP) == {
        "Field": "aB1",
        "StandardPadding": "cD2",
        "FieldLabel": "eF3",
    }


def test_resolve_classes():
    out, missing = slc.resolve_classes(
        '<div data-class="Field StandardPadding" id="r">', slc.parse_classmap(CLASSMAP)
    )
    assert out == '<div class="aB1 cD2" id="r">'
    assert missing == []


def test_resolve_classes_reports_unknown():
    out, missing = slc.resolve_classes(
        '<div data-class="Nope">', slc.parse_classmap(CLASSMAP)
    )
    assert out == '<div class="">'
    assert missing == ["Nope"]


def test_evaluate_bounds():
    rows = slc.evaluate(
        [
            {"name": "a", "value": 0, "min": 0, "max": 1},
            {"name": "b", "value": 5, "min": 0, "max": 1},
            {"name": "c", "value": 7},  # no bounds: always ok
        ]
    )
    assert [r[2] for r in rows] == ["ok", "FAIL", "ok"]


def test_extract_results_unescapes():
    dom = '<pre id="__layout_results">[{"name":"a","value":1}]</pre>'
    assert slc.extract_results(dom) == [{"name": "a", "value": 1}]


def _make_fake_chromium(tmp: Path, payload: str, name: str) -> Path:
    # Prints a DOM containing whatever the runner script would have written.
    fake = tmp / name
    fake.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        f"print('<pre id=\"__layout_results\">{payload}</pre>')\n"
    )
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    return fake


def _make_spec(tmp: Path) -> Path:
    spec = tmp / "spec"
    spec.mkdir()
    (spec / "page.html").write_text(
        '<html><body><div data-class="Field"></div></body></html>'
    )
    (spec / "check.js").write_text("window.__layoutCheck = () => [];")
    return spec


def _make_capture(tmp: Path) -> Path:
    cap = tmp / "capture"
    (cap / "css").mkdir(parents=True)
    (cap / "css" / "sp.css").write_text(".aB1{padding:12px}")
    (cap / "classmap.js").write_text(CLASSMAP)
    return cap


def test_end_to_end_pass_and_fail():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        cap = _make_capture(tmp)
        spec = _make_spec(tmp)
        ok = _make_fake_chromium(tmp, '{"name":"gap","value":6}', "fake-ok")
        fail = _make_fake_chromium(
            tmp, '{"name":"gap","value":0,"min":6,"max":8}', "fake-fail"
        )
        rc_ok = subprocess.run(
            [sys.executable, str(slc.__file__), str(cap), str(spec), "--chromium", str(ok)],
            capture_output=True,
            text=True,
        )
        assert rc_ok.returncode == 0, rc_ok.stderr
        assert "gap: 6" in rc_ok.stdout
        rc_fail = subprocess.run(
            [sys.executable, str(slc.__file__), str(cap), str(spec), "--chromium", str(fail)],
            capture_output=True,
            text=True,
        )
        assert rc_fail.returncode == 1
        assert "FAIL" in rc_fail.stdout


def test_missing_classmap_fails_cleanly():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        empty = tmp / "cap"
        empty.mkdir()
        rc = subprocess.run(
            [sys.executable, str(slc.__file__), str(empty), _make_spec(tmp)],
            capture_output=True,
            text=True,
        )
        assert rc.returncode == 2
        assert "classmap.js missing" in rc.stderr


def test_build_page_injects_links_and_runner():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        page = slc.build_page(_make_spec(tmp), _make_capture(tmp), slc.parse_classmap(CLASSMAP))
        assert 'class="aB1"' in page
        assert "sp.css" in page
        assert "__layoutCheck" in page
        assert page.rstrip().endswith("</html>")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok {name}")
