#!/usr/bin/env python3
"""Tests for tools/version.py — the single version shared by package.json,
plugin.json and backend/package.json, and the release tag built from it.

Standard library only, like tools/test_package.py. Every test works in a
temporary directory (ROOT redirected for its duration), so the real tree's
version is never touched; one test does check the real tree for drift.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location("wowdeck_version", Path(__file__).resolve().parent / "version.py")
assert _SPEC and _SPEC.loader
version = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(version)


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


class VersionFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = Path(tempfile.mkdtemp(prefix="wowdeck-version-"))
        self.addCleanup(shutil.rmtree, self._tmp, True)
        self._real_root = version.ROOT
        version.ROOT = self._tmp

    def tearDown(self) -> None:
        version.ROOT = self._real_root

    def write(self, versions: dict[str, str]) -> None:
        for rel, value in versions.items():
            data = {"name": "wowdeck", "version": value}
            write_json(self._tmp / rel, data)

    def test_accepts_full_semver_including_prereleases(self) -> None:
        for candidate in ("0.1.0", "1.0.0", "10.20.30", "1.0.0-rc1", "1.0.0-beta.2", "1.0.0+build.5"):
            self.assertTrue(version.SEMVER.match(candidate), candidate)

    def test_rejects_non_semver(self) -> None:
        for candidate in ("1.0", "v1.0.0", "1.0.0.0", "01.0.0", "1.0.x", "", "1.0.0 "):
            self.assertFalse(version.SEMVER.match(candidate), candidate)

    def test_check_passes_when_every_file_agrees(self) -> None:
        self.write({rel: "1.0.0" for rel in version.VERSIONED_FILES})
        self.assertEqual(version.check(), "1.0.0")

    def test_check_fails_naming_every_file_when_they_disagree(self) -> None:
        self.write({"package.json": "1.0.0", "plugin.json": "0.9.0", "backend/package.json": "1.0.0"})
        with self.assertRaises(SystemExit) as ctx:
            version.check()
        message = str(ctx.exception)
        self.assertIn("plugin.json: 0.9.0", message)
        self.assertIn("version-set", message)

    def test_check_fails_when_a_file_lacks_a_version(self) -> None:
        self.write({rel: "1.0.0" for rel in version.VERSIONED_FILES})
        write_json(self._tmp / "plugin.json", {"name": "wowdeck"})
        with self.assertRaises(SystemExit) as ctx:
            version.check()
        self.assertIn('no "version"', str(ctx.exception))

    def test_check_fails_on_malformed_json(self) -> None:
        self.write({rel: "1.0.0" for rel in version.VERSIONED_FILES})
        (self._tmp / "backend/package.json").write_text("{not json", encoding="utf-8")
        with self.assertRaises(SystemExit) as ctx:
            version.check()
        self.assertIn("not valid JSON", str(ctx.exception))

    def test_set_writes_all_three_files_and_keeps_their_other_keys(self) -> None:
        write_json(self._tmp / "package.json", {"name": "wowdeck", "version": "0.1.0", "type": "module"})
        write_json(self._tmp / "plugin.json", {"name": "WoWDeck", "api_version": 1})
        write_json(self._tmp / "backend/package.json", {"name": "wowdeck-backend", "version": "0.1.0"})

        version.set_version("1.0.0")

        root = json.loads((self._tmp / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(root["version"], "1.0.0")
        self.assertEqual(root["type"], "module")
        plugin = json.loads((self._tmp / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(plugin["version"], "1.0.0")
        self.assertEqual(plugin["name"], "WoWDeck")
        self.assertEqual(json.loads((self._tmp / "backend/package.json").read_text())["version"], "1.0.0")

    def test_set_preserves_two_space_formatting_and_a_trailing_newline(self) -> None:
        self.write({rel: "0.1.0" for rel in version.VERSIONED_FILES})
        version.set_version("1.2.3")
        text = (self._tmp / "package.json").read_text(encoding="utf-8")
        self.assertTrue(text.endswith("}\n"))
        self.assertIn('\n  "name": "wowdeck"', text)

    def test_set_leaves_hand_formatting_like_compact_arrays_alone(self) -> None:
        self.write({rel: "0.1.0" for rel in version.VERSIONED_FILES})
        (self._tmp / "plugin.json").write_text(
            '{\n  "name": "WoWDeck",\n'
            '  "publish": {\n    "tags": ["game"],\n    "description": "x"\n  },\n'
            '  "version": "0.1.0"\n}\n',
            encoding="utf-8",
        )
        version.set_version("1.0.0")
        text = (self._tmp / "plugin.json").read_text(encoding="utf-8")
        self.assertIn('"tags": ["game"],', text)
        self.assertIn('"version": "1.0.0"', text)
        self.assertEqual(text.count("1.0.0"), 1)

    def test_set_rejects_a_non_semver_and_touches_nothing(self) -> None:
        self.write({rel: "0.1.0" for rel in version.VERSIONED_FILES})
        with self.assertRaises(SystemExit):
            version.set_version("1.0")
        self.assertEqual(version.check(), "0.1.0")

    def test_set_does_not_half_apply_when_a_file_is_malformed(self) -> None:
        self.write({rel: "0.1.0" for rel in version.VERSIONED_FILES})
        (self._tmp / "backend/package.json").write_text("{not json", encoding="utf-8")
        with self.assertRaises(SystemExit):
            version.set_version("2.0.0")
        self.assertEqual(json.loads((self._tmp / "package.json").read_text())["version"], "0.1.0")


class TagTests(unittest.TestCase):
    """make_tag never pushes; these tests stand in for git so they need no repo."""

    def setUp(self) -> None:
        self._tmp = Path(tempfile.mkdtemp(prefix="wowdeck-tag-"))
        self.addCleanup(shutil.rmtree, self._tmp, True)
        self._real_root = version.ROOT
        version.ROOT = self._tmp
        for rel in version.VERSIONED_FILES:
            write_json(self._tmp / rel, {"name": "wowdeck", "version": "1.0.0"})
        self.calls: list[list[str]] = []
        self.dirty = ""
        self.existing: set[str] = set()
        self._real_git = version.git
        self._real_tag_exists = version.tag_exists
        version.git = self._fake_git
        version.tag_exists = lambda tag, root=None: tag in self.existing

    def tearDown(self) -> None:
        version.ROOT = self._real_root
        version.git = self._real_git
        version.tag_exists = self._real_tag_exists

    def _fake_git(self, args: list[str], root: Path | None = None) -> str:
        self.calls.append(args)
        if args[:2] == ["status", "--porcelain"]:
            return self.dirty
        if args[0] == "rev-parse" and "--short" in args:
            return "abc1234"
        return ""

    def test_creates_an_annotated_tag_named_after_the_version(self) -> None:
        self.assertEqual(version.make_tag(), "v1.0.0")
        self.assertIn(["tag", "-a", "v1.0.0", "-m", "v1.0.0"], self.calls)

    def test_refuses_a_dirty_tree(self) -> None:
        self.dirty = " M src/index.tsx\n"
        with self.assertRaises(SystemExit) as ctx:
            version.make_tag()
        self.assertIn("uncommitted changes", str(ctx.exception))
        self.assertNotIn(["tag", "-a", "v1.0.0", "-m", "v1.0.0"], self.calls)

    def test_refuses_a_version_mismatch(self) -> None:
        write_json(self._tmp / "plugin.json", {"name": "wowdeck", "version": "0.9.0"})
        with self.assertRaises(SystemExit) as ctx:
            version.make_tag()
        self.assertIn("disagree", str(ctx.exception))

    def test_refuses_an_existing_tag(self) -> None:
        self.existing.add("v1.0.0")
        with self.assertRaises(SystemExit) as ctx:
            version.make_tag()
        self.assertIn("already exists", str(ctx.exception))

    def test_ignores_untracked_files_when_deciding_cleanliness(self) -> None:
        self.assertEqual(version.make_tag(), "v1.0.0")
        self.assertIn(["status", "--porcelain", "--untracked-files=no"], self.calls)


class RealTreeTests(unittest.TestCase):
    """The real tree must declare exactly one version, and it must be taggable."""

    def test_the_real_tree_is_version_consistent(self) -> None:
        self.assertEqual(version.check(), version.read_version(version.ROOT / "package.json"))


if __name__ == "__main__":
    sys.exit(unittest.main())
