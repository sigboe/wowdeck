#!/usr/bin/env python3
"""Tests for build-time CurseForge key resolution/injection, using the
Python standard library only (no new test dependency). Run with:
python3 tools/test_package.py

Covers package.py's read_curseforge_key/write_curseforge_key_resource
— never touches the real local CURSEFORGE_API_KEY file (or
curseForgeAPIKey-dontcommit, which holds an unrelated key this project
isn't authorized to ship and is never read by this code at all) or a
real key value; every test uses a dummy value in an isolated temp
directory, with package.ROOT redirected there for the duration.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location("wowup_decky_package", Path(__file__).resolve().parent / "package.py")
assert _SPEC and _SPEC.loader
package = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(package)

DUMMY_KEY = "dummy-test-key-never-the-real-one"


class CurseForgeKeyResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.mkdtemp(prefix="wowdeck-pkgtest-")
        self._real_root = package.ROOT
        package.ROOT = Path(self._tmp)
        self._env_backup = os.environ.pop(package.CURSEFORGE_KEY_ENV_VAR, None)

    def tearDown(self) -> None:
        package.ROOT = self._real_root
        shutil.rmtree(self._tmp, ignore_errors=True)
        if self._env_backup is not None:
            os.environ[package.CURSEFORGE_KEY_ENV_VAR] = self._env_backup
        else:
            os.environ.pop(package.CURSEFORGE_KEY_ENV_VAR, None)

    def _local_key_path(self) -> Path:
        return package.ROOT / package.CURSEFORGE_KEY_LOCAL_FILE

    def test_missing_local_file_and_no_env_is_no_bundled_key(self) -> None:
        self.assertIsNone(package.read_curseforge_key())

    def test_empty_local_file_is_treated_as_missing(self) -> None:
        self._local_key_path().write_text("", encoding="utf-8")
        self.assertIsNone(package.read_curseforge_key())

    def test_whitespace_only_local_file_is_treated_as_missing(self) -> None:
        self._local_key_path().write_text("   \n\t  \n", encoding="utf-8")
        self.assertIsNone(package.read_curseforge_key())

    def test_local_file_with_a_key_is_read_and_trimmed(self) -> None:
        self._local_key_path().write_text(f"  {DUMMY_KEY}  \n", encoding="utf-8")
        self.assertEqual(package.read_curseforge_key(), DUMMY_KEY)

    def test_env_var_works_for_release_style_builds(self) -> None:
        os.environ[package.CURSEFORGE_KEY_ENV_VAR] = DUMMY_KEY
        self.assertEqual(package.read_curseforge_key(), DUMMY_KEY)

    def test_env_var_takes_precedence_over_the_local_file(self) -> None:
        self._local_key_path().write_text("local-file-key", encoding="utf-8")
        os.environ[package.CURSEFORGE_KEY_ENV_VAR] = DUMMY_KEY
        self.assertEqual(package.read_curseforge_key(), DUMMY_KEY)

    def test_whitespace_only_env_var_falls_back_to_the_local_file(self) -> None:
        self._local_key_path().write_text("local-file-key", encoding="utf-8")
        os.environ[package.CURSEFORGE_KEY_ENV_VAR] = "   "
        self.assertEqual(package.read_curseforge_key(), "local-file-key")


class CurseForgeKeyResourceWritingTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.mkdtemp(prefix="wowdeck-pkgtest-")
        self._real_root = package.ROOT
        package.ROOT = Path(self._tmp)
        self._env_backup = os.environ.pop(package.CURSEFORGE_KEY_ENV_VAR, None)
        self.bin_dir = package.ROOT / "bin"
        self.bin_dir.mkdir(parents=True)

    def tearDown(self) -> None:
        package.ROOT = self._real_root
        shutil.rmtree(self._tmp, ignore_errors=True)
        if self._env_backup is not None:
            os.environ[package.CURSEFORGE_KEY_ENV_VAR] = self._env_backup
        else:
            os.environ.pop(package.CURSEFORGE_KEY_ENV_VAR, None)

    def _resource_path(self) -> Path:
        return self.bin_dir / package.CURSEFORGE_KEY_RESOURCE_NAME

    def test_missing_key_never_writes_the_resource_and_the_build_still_succeeds(self) -> None:
        wrote = package.write_curseforge_key_resource(self.bin_dir)
        self.assertFalse(wrote)
        self.assertFalse(self._resource_path().exists())

    def test_a_key_is_written_into_the_generated_resource(self) -> None:
        os.environ[package.CURSEFORGE_KEY_ENV_VAR] = DUMMY_KEY
        wrote = package.write_curseforge_key_resource(self.bin_dir)
        self.assertTrue(wrote)
        self.assertEqual(self._resource_path().read_text(encoding="utf-8"), DUMMY_KEY)

    def test_the_raw_local_key_file_itself_is_never_copied_into_bin(self) -> None:
        (package.ROOT / package.CURSEFORGE_KEY_LOCAL_FILE).write_text(DUMMY_KEY, encoding="utf-8")
        package.write_curseforge_key_resource(self.bin_dir)
        self.assertFalse((self.bin_dir / package.CURSEFORGE_KEY_LOCAL_FILE).exists())

    def test_a_stale_resource_from_a_previous_build_is_removed_when_no_key_is_available_now(self) -> None:
        self._resource_path().write_text("stale-key-from-last-build", encoding="utf-8")
        wrote = package.write_curseforge_key_resource(self.bin_dir)
        self.assertFalse(wrote)
        self.assertFalse(self._resource_path().exists())

    def test_repeated_builds_with_different_keys_never_leak_the_old_value(self) -> None:
        os.environ[package.CURSEFORGE_KEY_ENV_VAR] = "first-dummy-key"
        package.write_curseforge_key_resource(self.bin_dir)
        self.assertEqual(self._resource_path().read_text(encoding="utf-8"), "first-dummy-key")

        os.environ[package.CURSEFORGE_KEY_ENV_VAR] = "second-dummy-key"
        package.write_curseforge_key_resource(self.bin_dir)
        self.assertEqual(self._resource_path().read_text(encoding="utf-8"), "second-dummy-key")


class FrontendDistCopyTests(unittest.TestCase):
    """The zip carries the bundle, never the sourcemap: it is ~2.4 MB of pure
    download weight (re-downloaded on every update) and Decky never reads it."""

    def setUp(self) -> None:
        self._tmp = Path(tempfile.mkdtemp(prefix="wowdeck-dist-"))
        self.addCleanup(shutil.rmtree, self._tmp, True)
        self.src = self._tmp / "dist"
        self.src.mkdir()
        (self.src / "index.js").write_text("console.log(1)\n", encoding="utf-8")
        (self.src / "index.js.map").write_text("{}\n", encoding="utf-8")

    def test_copies_the_bundle_and_drops_the_sourcemap(self) -> None:
        package.copy_frontend_dist(self.src, self._tmp / "stage")
        self.assertTrue((self._tmp / "stage" / "index.js").exists())
        self.assertFalse((self._tmp / "stage" / "index.js.map").exists())

    def test_copies_every_non_map_file(self) -> None:
        (self.src / "other.js").write_text("x\n", encoding="utf-8")
        package.copy_frontend_dist(self.src, self._tmp / "stage")
        self.assertTrue((self._tmp / "stage" / "other.js").exists())


class RootFilesTests(unittest.TestCase):
    """The licenses travel with the code that uses them: about.get reads
    THIRD_PARTY_NOTICES.md from the installed plugin folder."""

    def test_the_notices_ship_next_to_the_license(self) -> None:
        self.assertIn("LICENSE", package.ROOT_FILES)
        self.assertIn("THIRD_PARTY_NOTICES.md", package.ROOT_FILES)


class AboutSnapshotTests(unittest.TestCase):
    """The zip carries a snapshot of each file About fetches from `next`
    (ADR-0005): the fallback on a first run with no network. The engine
    reads it from about-snapshot/ (backend/src/about/FetchedFile.ts)."""

    def setUp(self) -> None:
        self._tmp = Path(tempfile.mkdtemp(prefix="wowdeck-pkgtest-"))
        self.root = self._tmp / "repo"
        self.root.mkdir()
        self.stage = self._tmp / "stage"
        self.stage.mkdir()

    def tearDown(self) -> None:
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_supporters_are_snapshotted(self) -> None:
        self.assertIn("SUPPORTERS.md", package.ABOUT_SNAPSHOT_FILES)

    def test_funding_is_snapshotted(self) -> None:
        self.assertIn(".github/FUNDING.yml", package.ABOUT_SNAPSHOT_FILES)

    def test_the_repo_has_every_snapshotted_file(self) -> None:
        for name in package.ABOUT_SNAPSHOT_FILES:
            self.assertTrue((package.ROOT / name).is_file(), name)

    def test_each_file_lands_in_about_snapshot_under_its_own_name(self) -> None:
        (self.root / "SUPPORTERS.md").write_text("- Ada\n", encoding="utf-8")
        (self.root / ".github").mkdir()
        (self.root / ".github" / "FUNDING.yml").write_text("ko_fi: x\n", encoding="utf-8")
        package.copy_about_snapshot(self.root, self.stage, ("SUPPORTERS.md", ".github/FUNDING.yml"))
        self.assertEqual((self.stage / "about-snapshot" / "SUPPORTERS.md").read_text(encoding="utf-8"), "- Ada\n")
        self.assertTrue((self.stage / "about-snapshot" / "FUNDING.yml").is_file())

    def test_a_missing_file_fails_the_build(self) -> None:
        with self.assertRaises(FileNotFoundError):
            package.copy_about_snapshot(self.root, self.stage, ("SUPPORTERS.md",))


class PluginDisplayNameTests(unittest.TestCase):
    """plugin_display_name() names the one zip so Decky Loader's local-zip
    install flow (which checks "is this already installed?" against the
    picked file's bare filename, before it has read plugin.json) sees a name
    that actually matches; see zip_path() for the full mechanism."""

    def setUp(self) -> None:
        self._tmp = tempfile.mkdtemp(prefix="wowdeck-pkgtest-")
        self._real_root = package.ROOT
        package.ROOT = Path(self._tmp)

    def tearDown(self) -> None:
        package.ROOT = self._real_root
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_reads_the_name_field_from_plugin_json(self) -> None:
        (package.ROOT / "plugin.json").write_text('{"name": "WoWDeck"}', encoding="utf-8")
        self.assertEqual(package.plugin_display_name(), "WoWDeck")

    def test_tracks_whatever_the_real_plugin_json_name_actually_is(self) -> None:
        real_name = json.loads((Path(__file__).resolve().parent.parent / "plugin.json").read_text())["name"]
        (package.ROOT / "plugin.json").write_text(json.dumps({"name": real_name}), encoding="utf-8")
        self.assertEqual(package.plugin_display_name(), real_name)

    def test_the_zip_is_named_after_the_plugin_and_never_a_version(self) -> None:
        (package.ROOT / "plugin.json").write_text('{"name": "WoWDeck"}', encoding="utf-8")
        self.assertEqual(package.zip_path(), package.ROOT / "build" / "WoWDeck.zip")


ELF_MACHINE_X86_64 = 62
ELF_MACHINE_AARCH64 = 183
X86_64_LOADER = "/lib64/ld-linux-x86-64.so.2"
AARCH64_LOADER = "/lib/ld-linux-aarch64.so.1"

STANDARD_LOADERS = {
    ELF_MACHINE_X86_64: X86_64_LOADER,
    ELF_MACHINE_AARCH64: AARCH64_LOADER,
}


def make_elf(interp: str, machine: int = ELF_MACHINE_X86_64) -> bytes:
    """A minimal 64-bit little-endian ELF header with one PT_INTERP program header."""
    data = interp.encode() + b"\0"
    phoff, off = 64, 64 + 56
    header = bytearray(64)
    header[0:4] = b"\x7fELF"
    header[4], header[5] = 2, 1
    header[18:20] = machine.to_bytes(2, "little")
    header[32:40] = phoff.to_bytes(8, "little")
    header[54:56] = (56).to_bytes(2, "little")
    header[56:58] = (1).to_bytes(2, "little")
    ph = bytearray(56)
    ph[0:4] = (3).to_bytes(4, "little")
    ph[8:16] = off.to_bytes(8, "little")
    ph[32:40] = len(data).to_bytes(8, "little")
    return bytes(header) + bytes(ph) + data


class EngineStagingTests(unittest.TestCase):
    """bin/ holds one engine per architecture, named after `uname -m`, each
    an ELF for that machine pointing at its standard loader."""

    def setUp(self) -> None:
        self._tmp = Path(tempfile.mkdtemp(prefix="wowdeck-engines-"))
        self.addCleanup(shutil.rmtree, self._tmp, True)
        self.out = self._tmp / "out"
        self.out.mkdir()
        self.bin = self._tmp / "stage" / "bin"
        self.bin.mkdir(parents=True)

    def _build(self, name: str, machine: int, interp: str | None = None) -> Path:
        path = self.out / name
        loader = interp if interp is not None else STANDARD_LOADERS[machine]
        path.write_bytes(make_elf(loader, machine))
        path.chmod(0o644)
        return path

    def _build_all(self) -> None:
        self._build("wowdeck-x86_64", ELF_MACHINE_X86_64)
        self._build("wowdeck-aarch64", ELF_MACHINE_AARCH64)

    def test_stages_each_engine_executable_with_its_own_standard_loader(self) -> None:
        self._build_all()
        package.stage_engines(self.out, self.bin)
        for name, loader in ((e.binary, e.loader) for e in package.ENGINES.values()):
            engine = self.bin / name
            self.assertTrue(engine.is_file(), name)
            self.assertTrue(os.access(engine, os.X_OK), name)
            self.assertEqual(package.read_interpreter(engine), loader, name)

    def test_there_is_no_plain_bin_wowdeck(self) -> None:
        self._build_all()
        package.stage_engines(self.out, self.bin)
        self.assertFalse((self.bin / "wowdeck").exists())

    def test_no_engines_at_all_fails_the_build_naming_the_first_missing_file(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            package.stage_engines(self.out, self.bin)
        self.assertIn("wowdeck-x86_64", str(ctx.exception))

    def test_a_missing_aarch64_engine_fails_the_build_naming_the_file(self) -> None:
        self._build("wowdeck-x86_64", ELF_MACHINE_X86_64)
        with self.assertRaises(SystemExit) as ctx:
            package.stage_engines(self.out, self.bin)
        self.assertIn("wowdeck-aarch64", str(ctx.exception))

    def test_an_x86_64_elf_named_aarch64_fails_the_build_naming_the_file(self) -> None:
        self._build("wowdeck-x86_64", ELF_MACHINE_X86_64)
        self._build("wowdeck-aarch64", ELF_MACHINE_X86_64)
        with self.assertRaises(SystemExit) as ctx:
            package.stage_engines(self.out, self.bin)
        self.assertIn("wowdeck-aarch64", str(ctx.exception))
        self.assertFalse((self.bin / "wowdeck-aarch64").exists())

    def test_an_aarch64_elf_named_x86_64_fails_the_build_naming_the_file(self) -> None:
        self._build("wowdeck-x86_64", ELF_MACHINE_AARCH64)
        self._build("wowdeck-aarch64", ELF_MACHINE_AARCH64)
        with self.assertRaises(SystemExit) as ctx:
            package.stage_engines(self.out, self.bin)
        self.assertIn("wowdeck-x86_64", str(ctx.exception))
        self.assertFalse((self.bin / "wowdeck-x86_64").exists())


class InterpreterCheckTests(unittest.TestCase):
    """The packager must never ship an engine whose ELF loader is missing on SteamOS."""

    def _write(self, interp: str) -> Path:
        tmp = Path(tempfile.mkdtemp(prefix="wowdeck-elf-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        path = tmp / "engine"
        path.write_bytes(make_elf(interp))
        return path

    def test_reads_the_interpreter(self) -> None:
        path = self._write(X86_64_LOADER)
        self.assertEqual(package.read_interpreter(path), X86_64_LOADER)

    def test_standard_loader_passes_without_patchelf(self) -> None:
        path = self._write(X86_64_LOADER)
        real_which = package.shutil.which
        package.shutil.which = lambda _name: None
        try:
            package.patch_interpreter(path, X86_64_LOADER)
        finally:
            package.shutil.which = real_which

    def test_nix_loader_without_patchelf_fails_the_build(self) -> None:
        path = self._write("/nix/store/abc-glibc/lib/ld-linux-x86-64.so.2")
        real_which = package.shutil.which
        package.shutil.which = lambda _name: None
        try:
            with self.assertRaises(SystemExit) as ctx:
                package.patch_interpreter(path, X86_64_LOADER)
        finally:
            package.shutil.which = real_which
        self.assertIn("patchelf", str(ctx.exception))

    def test_rejects_non_elf(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="wowdeck-elf-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        path = tmp / "notelf"
        path.write_bytes(b"#!/bin/sh\n" + b"\0" * 64)
        with self.assertRaises(SystemExit):
            package.read_interpreter(path)


if __name__ == "__main__":
    sys.exit(unittest.main())
