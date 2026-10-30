#!/usr/bin/env python3
"""One version, three files, one tag.

The plugin's version lives in three JSON files that must always agree:

    package.json             Decky Loader reads it for the plugin list and
                             for update comparisons
    plugin.json              external tooling (Direct Updater, custom-store
                             catalogs, store conventions) reads it
    backend/package.json     the engine's own package, kept in step so the
                             tree never claims two versions

Usage:

    python3 tools/version.py show            # print the version
    python3 tools/version.py check           # fail unless all three agree
    python3 tools/version.py set 1.0.0       # write it to all three
    python3 tools/version.py stamp 0.3.1-beta.57
                                             # a beta build's version, CI only
    python3 tools/version.py tag             # create the v<version> tag

`make version-set`, `make version-check` and `make release-tag` wrap
`set`, `check` and `tag`.  `check` also runs in the packaging tests and in the release
workflow, so a tree whose files disagree can never produce a release: the
tag, the GitHub Release, the zip inside it and the version Decky displays
all come from the same number.

`stamp` is `set` restricted to the X.Y.Z-beta.N form: the beta workflow
(.github/workflows/beta.yml) stamps the build's version into its checkout
before building and never commits it, so `next` keeps claiming the last
stable version and `set`/`tag` stay the only way a release is made.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Relative to ROOT, in the order they are written.
VERSIONED_FILES = ("package.json", "plugin.json", "backend/package.json")

# Full semver (pre-release and build metadata allowed) so a release
# candidate can exercise the whole pipeline before the real launch.
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")

# The only form `stamp` writes: tools/beta-release.ts's next-version output.
BETA = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$")

TAG_PREFIX = "v"


class VersionError(SystemExit):
    """A user-facing failure: printed as-is, exit code 1."""

    def __init__(self, message: str) -> None:
        super().__init__(f"error: {message}")


def paths(root: Path | None = None) -> list[Path]:
    root = ROOT if root is None else root
    return [root / rel for rel in VERSIONED_FILES]


def read_version(path: Path) -> str:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise VersionError(f"{path} is not valid JSON: {e}") from None
    version = data.get("version")
    if not isinstance(version, str) or not version:
        raise VersionError(f'{path} has no "version" string')
    return version


def versions(root: Path | None = None) -> dict[str, str]:
    """Every versioned file's version, keyed by its repo-relative path."""
    root = ROOT if root is None else root
    return {rel: read_version(root / rel) for rel in VERSIONED_FILES}


def check(root: Path | None = None) -> str:
    """Return the agreed version, or fail naming every file that disagrees."""
    root = ROOT if root is None else root
    found = versions(root)
    distinct = set(found.values())
    if len(distinct) != 1:
        lines = [f'  {rel}: {version}' for rel, version in found.items()]
        raise VersionError(
            "the versioned files disagree; run `make version-set VERSION=X.Y.Z`:\n" + "\n".join(lines)
        )
    version = distinct.pop()
    if not SEMVER.match(version):
        raise VersionError(f"{version} is not a semver version (expected X.Y.Z, optionally with -rc1)")
    return version


# A top-level `"version"` key, two-space indented, as every versioned file
# writes it. Substituting the value keeps the rest of each file — including
# compact arrays such as plugin.json's "tags" — byte-identical.
TOP_LEVEL_VERSION = re.compile(r'(?m)^  "version": "[^"]*"')


def set_version(version: str, root: Path | None = None) -> None:
    """Write `version` into all three files, leaving everything else alone.

    Editing the text rather than re-serialising the JSON matters: a dump
    would reformat hand-formatted files (plugin.json's single-line "tags"
    array) on every bump, which is noise in the release commit.
    """
    root = ROOT if root is None else root
    if not SEMVER.match(version):
        raise VersionError(f"{version!r} is not a semver version (expected X.Y.Z, optionally with -rc1)")
    # Read everything first so a malformed file cannot leave the tree half-bumped.
    parsed = []
    for path in paths(root):
        text = path.read_text(encoding="utf-8")
        try:
            json.loads(text)
        except json.JSONDecodeError as e:
            raise VersionError(f"{path} is not valid JSON: {e}") from None
        parsed.append((path, text))

    replacements = []
    for path, text in parsed:
        updated, count = TOP_LEVEL_VERSION.subn(f'  "version": "{version}"', text, count=1)
        if count == 0:
            body = text.lstrip()
            if not body.startswith("{"):
                raise VersionError(f"{path} has no top-level object to add a version to")
            head = text[: len(text) - len(body)]
            updated = f'{head}{{\n  "version": "{version}",{body[1:]}'
        try:
            json.loads(updated)
        except json.JSONDecodeError as e:
            raise VersionError(f"{path} would not be valid JSON after the bump: {e}") from None
        replacements.append((path, updated))

    for path, updated in replacements:
        path.write_text(updated, encoding="utf-8")
        print(f"{path.relative_to(root)}: version {version}")


def stamp_beta(version: str, root: Path | None = None) -> None:
    """Write a beta build's version into the checkout being built; never committed."""
    if not BETA.match(version):
        raise VersionError(f"{version!r} is not a beta version (expected X.Y.Z-beta.N)")
    set_version(version, root)


def git(args: list[str], root: Path | None = None) -> str:
    root = ROOT if root is None else root
    result = subprocess.run(
        ["git", *args], cwd=root, check=False, capture_output=True, text=True
    )
    if result.returncode != 0:
        raise VersionError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def tag_exists(tag: str, root: Path | None = None) -> bool:
    root = ROOT if root is None else root
    result = subprocess.run(
        ["git", "rev-parse", "-q", "--verify", f"refs/tags/{tag}"],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def make_tag(root: Path | None = None) -> str:
    """Create the release tag after proving the tree is taggable. Never
    pushes: printing the command keeps the push a deliberate act."""
    root = ROOT if root is None else root
    version = check(root)
    tag = f"{TAG_PREFIX}{version}"

    dirty = git(["status", "--porcelain", "--untracked-files=no"], root).strip()
    if dirty:
        raise VersionError(
            "the working tree has uncommitted changes; commit them first so the tag "
            "points at the release commit:\n" + dirty
        )
    if tag_exists(tag, root):
        raise VersionError(f"tag {tag} already exists")
    git(["tag", "-a", tag, "-m", tag], root)
    print(f"created tag {tag} on {git(['rev-parse', '--short', 'HEAD'], root).strip()}")
    print(f"push it to publish the release:  git push origin {tag}")
    return tag


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    commands = ("show", "check", "set", "stamp", "tag")
    if not argv:
        print(__doc__.strip(), file=sys.stderr)
        return 1
    if argv[0] in ("-h", "--help"):
        print(__doc__.strip(), file=sys.stderr)
        return 0
    if argv[0] not in commands:
        print(__doc__.strip(), file=sys.stderr)
        raise VersionError(f"unknown command {argv[0]!r}")

    command, args = argv[0], argv[1:]
    if command == "show":
        if args:
            raise VersionError("show takes no arguments")
        print(check())
    elif command == "check":
        if args:
            raise VersionError("check takes no arguments")
        version = check()
        print(f"version {version} is consistent across {', '.join(VERSIONED_FILES)}")
    elif command == "set":
        if len(args) != 1:
            raise VersionError("set takes exactly one version, e.g. `version.py set 1.0.0`")
        set_version(args[0])
    elif command == "stamp":
        if len(args) != 1:
            raise VersionError("stamp takes exactly one version, e.g. `version.py stamp 0.3.1-beta.57`")
        stamp_beta(args[0])
    else:
        if args:
            raise VersionError("tag takes no arguments")
        make_tag()
    return 0


if __name__ == "__main__":
    sys.exit(main())
