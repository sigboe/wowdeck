#!/usr/bin/env python3
"""Package the plugin into a distributable decky zip.

Layout produced (matches decky-loader expectations):

    build/<plugin.json name>.zip        (currently build/WoWDeck.zip)
        wowdeck/
            plugin.json
            package.json       (required by decky-loader: its presence gates
                                install, "version" is shown in the plugin
                                list, "type": "module" selects the ESM
                                frontend load path)
            main.py
            decky.pyi          (for reference; harmless)
            README.md, LICENSE, THIRD_PARTY_NOTICES.md
                               (the notices are shown in Options › About)
            about-snapshot/SUPPORTERS.md, about-snapshot/FUNDING.yml
                               (About's fallback for the files it fetches
                                from `next`; see ABOUT_SNAPSHOT_FILES)
            defaults/...       (if present)
            py_modules/...     (if present)
            dist/index.js      (frontend bundle; the sourcemap next to it is
                                build-time only and is never packaged)
            bin/wowdeck    (engine binary)
            bin/xclip          (vendored, for Copy Diagnostics;
                                see THIRD_PARTY_NOTICES.md)
            bin/bundled-curseforge-key  (only when a key is available; see
                                write_curseforge_key_resource. main.py reads
                                this and injects it into the engine's
                                environment; never committed, never printed,
                                excluded from Git by build/** in .gitignore
                                like every other build output.)

The zip is named after plugin.json's `name`, never a version: Decky
Loader's "install from local zip" decides whether the plugin is already
installed from the picked file's name, so any other name makes it skip
stopping the running plugin and an update hangs (see `zip_path()`). There
used to be a second, version-numbered copy; it was byte-identical, always
"v0.1.0", and installing it hit exactly that hang, so it is gone.

The zip is built from a staging copy of the plugin folder,
build/wowdeck/, which is deleted afterwards. `--keep-stage` leaves it:
it is the exact folder that lands on the Deck, for comparing with or
copying onto a test device file by file, or extracting into Decky's
dev-plugins folder.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGE = ROOT / "build" / "wowdeck"

# Repo-root files copied into the plugin folder as they are. The third-party
# notices travel with the code that uses them, and Options › About reads them
# from the installed plugin (about.get).
ROOT_FILES = (
    "plugin.json",
    "package.json",
    "main.py",
    "decky.pyi",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
)

# Repo files Options › About fetches live from `next` (ADR-0005). The zip
# carries a snapshot of each in about-snapshot/<file name>, the fallback on a
# first run with no network (backend/src/about/FetchedFile.ts).
ABOUT_SNAPSHOT_DIR = "about-snapshot"
ABOUT_SNAPSHOT_FILES = ("SUPPORTERS.md", ".github/FUNDING.yml")

# Standard Linux x86_64 dynamic loader. NixOS-built binaries reference the
# Nix store loader instead, which does not exist on SteamOS; rewriting the
# interpreter makes the binary portable. On conventional distros this is a
# no-op rewrite.
TARGET_INTERPRETER = "/lib64/ld-linux-x86-64.so.2"

# The key the project is authorized to ship is resolved from exactly one
# of these, with the CI secret/environment variable taking precedence for
# automated release builds:
#
#   - the CURSEFORGE_API_KEY environment variable (CI/release builds), or
#   - a local file literally named CURSEFORGE_API_KEY at the repo root
#     (local dev/packaging), containing the key this project is actually
#     authorized to ship; it is gitignored.
#
# `curseForgeAPIKey-dontcommit` is deliberately NOT a source here, despite
# the similar name: that file holds a different, personal/testing key
# this project is explicitly not authorized to ship. It's left alone
# (still gitignored) for whatever local testing it's used for elsewhere,
# but the bundling path must never read it.
#
# Neither value is ever printed, logged, or written anywhere but the one
# generated resource file below.
CURSEFORGE_KEY_ENV_VAR = "CURSEFORGE_API_KEY"
CURSEFORGE_KEY_LOCAL_FILE = "CURSEFORGE_API_KEY"
CURSEFORGE_KEY_RESOURCE_NAME = "bundled-curseforge-key"


def plugin_display_name() -> str:
    """plugin.json's own `name` field — the exact string Decky Loader's
    `find_plugin_folder()` compares against an installed plugin's
    plugin.json to decide whether it's already installed. It names the zip
    (see `zip_path()`)."""
    return json.loads((ROOT / "plugin.json").read_text(encoding="utf-8"))["name"]


def read_curseforge_key() -> str | None:
    """Resolve the key to bundle, never printing it. `None` means "no
    bundled key for this build" — a fully supported configuration: forks
    and dev builds without either source must still produce a working,
    if bundle-less, package."""
    env_value = os.environ.get(CURSEFORGE_KEY_ENV_VAR, "").strip()
    if env_value:
        return env_value
    local_path = ROOT / CURSEFORGE_KEY_LOCAL_FILE
    if local_path.exists():
        try:
            value = local_path.read_text(encoding="utf-8").strip()
        except OSError:
            return None
        if value:
            return value
    return None


def write_curseforge_key_resource(bin_dir: Path) -> bool:
    """Writes (or removes) the generated runtime resource `main.py`
    reads to inject the bundled key into the engine's environment.
    Returns whether a key was actually written. Overwrites any stale
    file from a previous build and removes it outright when no key is
    available now, so a stale/revoked key from an earlier build can
    never silently keep shipping. Never prints the key value itself —
    only whether one was found."""
    resource_path = bin_dir / CURSEFORGE_KEY_RESOURCE_NAME
    key = read_curseforge_key()
    if key is None:
        if resource_path.exists():
            resource_path.unlink()
        print(
            "note: no CurseForge API key available "
            f"({CURSEFORGE_KEY_ENV_VAR} env var unset, and no ./{CURSEFORGE_KEY_LOCAL_FILE} file) "
            "— building a no-bundled-key package; user-provided keys remain fully supported."
        )
        return False
    resource_path.write_text(key, encoding="utf-8")
    resource_path.chmod(0o600)
    print(f"bundled CurseForge API key written to {resource_path.relative_to(ROOT)} (value not printed)")
    return True


def read_interpreter(binary: Path) -> str:
    """Read PT_INTERP from a 64-bit little-endian ELF without external tools."""
    with binary.open("rb") as f:
        head = f.read(64)
        if head[:4] != b"\x7fELF" or head[4] != 2 or head[5] != 1:
            raise SystemExit(f"{binary} is not a 64-bit little-endian ELF")
        phoff = int.from_bytes(head[32:40], "little")
        phentsize = int.from_bytes(head[54:56], "little")
        phnum = int.from_bytes(head[56:58], "little")
        for i in range(phnum):
            f.seek(phoff + i * phentsize)
            ph = f.read(phentsize)
            if int.from_bytes(ph[0:4], "little") == 3:  # PT_INTERP
                offset = int.from_bytes(ph[8:16], "little")
                size = int.from_bytes(ph[32:40], "little")
                f.seek(offset)
                return f.read(size).split(b"\0", 1)[0].decode()
    raise SystemExit(f"{binary} has no ELF interpreter")


def patch_interpreter(binary: Path) -> None:
    """Make the engine use the standard loader, or stop the build.

    A binary built under Nix points at a /nix/store loader that does not exist
    on SteamOS; the engine then fails to start with no useful error. Shipping
    one is never right, so a missing patchelf is fatal unless the binary is
    already correct.
    """
    current = read_interpreter(binary)
    if current == TARGET_INTERPRETER:
        return
    patchelf = shutil.which("patchelf")
    if not patchelf:
        raise SystemExit(
            f"engine binary uses loader {current}, which SteamOS does not have, and "
            "patchelf is not installed. Run the packager inside "
            "`nix shell nixpkgs#patchelf` (see docs/steam-deck.md)."
        )
    subprocess.run([patchelf, "--set-interpreter", TARGET_INTERPRETER, str(binary)], check=True)
    print(f"patched interpreter: {current} -> {TARGET_INTERPRETER}")
    after = read_interpreter(binary)
    if after != TARGET_INTERPRETER:
        raise SystemExit(f"interpreter is still {after} after patchelf")


def run(cmd: list[str]) -> None:
    print(f"+ {' '.join(cmd)}")
    subprocess.run(cmd, check=True, cwd=ROOT)


# Rollup writes a sourcemap next to the bundle. It is useful locally (Steam's
# CEF devtools loads it) and pure download weight in the zip — roughly 2.4 MB
# on every install and every update — so only the bundle ships.
FRONTEND_IGNORE = ("*.map",)


def copy_frontend_dist(src: Path, dst: Path) -> None:
    """Stage dist/ without its sourcemaps."""
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns(*FRONTEND_IGNORE))


def copy_about_snapshot(root: Path, stage: Path, files: tuple[str, ...] = ABOUT_SNAPSHOT_FILES) -> None:
    """Stage each fetched file's snapshot under its own name. A missing file
    fails the build: without it a first run offline would show nothing."""
    dst = stage / ABOUT_SNAPSHOT_DIR
    dst.mkdir(parents=True, exist_ok=True)
    for name in files:
        src = root / name
        if not src.is_file():
            raise FileNotFoundError(f"{name} is missing; the zip's About snapshot needs it")
        shutil.copy2(src, dst / Path(name).name)


def zip_path() -> Path:
    """The one zip: named exactly after plugin.json's `name`. Decky Loader's
    "install plugin from local zip" flow (the sideload path for a plugin not
    in the store) derives its *pre-extraction* name from the picked file's
    name (frontend store.tsx's `installFromURL`:
    `url.split('/').pop().replace('.zip', '')`) and checks whether the plugin
    is installed against THAT name before it has looked inside the zip
    (backend browser.py's `_install`). Any other file name never matches, so
    Decky treats an update as a fresh install, skips stopping the running
    plugin and extracts over its live files: the "zip update hangs unless you
    uninstall first" bug (verified against Decky Loader v3.2.10's source)."""
    return ROOT / "build" / f"{plugin_display_name()}.zip"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Package the plugin into build/<plugin name>.zip.")
    parser.add_argument(
        "--keep-stage",
        action="store_true",
        help="keep build/wowdeck/ (the unzipped plugin folder) for testing on a device",
    )
    args = parser.parse_args(argv)

    missing = []
    if not (ROOT / "dist" / "index.js").exists():
        missing.append("dist/index.js (run: pnpm run build)")
    if not (ROOT / "backend" / "out" / "wowdeck").exists():
        missing.append("backend/out/wowdeck (run: cd backend && bun run build)")
    if missing:
        print("Missing build outputs:", file=sys.stderr)
        for m in missing:
            print(f"  - {m}", file=sys.stderr)
        return 1

    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)

    for item in ROOT_FILES:
        src = ROOT / item
        if src.exists():
            shutil.copy2(src, STAGE / item)
    for folder in ("defaults", "py_modules"):
        src = ROOT / folder
        if src.is_dir() and any(src.iterdir()):
            shutil.copytree(src, STAGE / folder)
    copy_frontend_dist(ROOT / "dist", STAGE / "dist")
    copy_about_snapshot(ROOT, STAGE)
    bin_dir = STAGE / "bin"
    bin_dir.mkdir()
    shutil.copy2(ROOT / "backend" / "out" / "wowdeck", bin_dir / "wowdeck")
    patch_interpreter(bin_dir / "wowdeck")
    bin_dir.joinpath("wowdeck").chmod(0o755)

    xclip_src = ROOT / "backend" / "vendor" / "xclip"
    if xclip_src.exists():
        shutil.copy2(xclip_src, bin_dir / "xclip")
        bin_dir.joinpath("xclip").chmod(0o755)
    else:
        print("note: backend/vendor/xclip not found; Copy Diagnostics will be unavailable")

    write_curseforge_key_resource(bin_dir)

    out = zip_path()
    # Older builds wrote other zips here (a version-numbered copy, or one named
    # after a former plugin.json name before a rename); never leave one around
    # to be installed by mistake.
    for stale in (ROOT / "build").glob("*.zip"):
        if stale != out:
            stale.unlink()
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(STAGE.rglob("*")):
            zf.write(path, path.relative_to(STAGE.parent))
    print(f"Packaged {out} ({out.stat().st_size / 1_000_000:.1f} MB)")
    if args.keep_stage:
        print(f"Kept {STAGE} (--keep-stage)")
    else:
        shutil.rmtree(STAGE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
