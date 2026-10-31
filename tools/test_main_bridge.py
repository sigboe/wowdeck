#!/usr/bin/env python3
"""Tests for main.py's RPC surface, using the Python standard library only.
Run with: python3 tools/test_main_bridge.py

main.py imports Decky's `decky` module, which only exists inside Decky
Loader, so a minimal stand-in is installed in sys.modules first. No engine
process is started: the plugin's backend is replaced with a stub.
"""

from __future__ import annotations

import asyncio
import contextlib
import importlib.util
import logging
import os
import stat
import sys
import tempfile
import types
import unittest
from pathlib import Path
from typing import Any

_decky = types.ModuleType("decky")
_decky.logger = logging.getLogger("test-decky")  # type: ignore[attr-defined]
_decky.DECKY_PLUGIN_DIR = "/nonexistent"  # type: ignore[attr-defined]


async def _emit(*_args: Any) -> None:
    return None


_decky.emit = _emit  # type: ignore[attr-defined]
sys.modules.setdefault("decky", _decky)

_SPEC = importlib.util.spec_from_file_location(
    "wowup_decky_main", Path(__file__).resolve().parent.parent / "main.py"
)
assert _SPEC and _SPEC.loader
main = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(main)


class StubBackend:
    """Records requests; answers with `result` or raises `error`."""

    def __init__(self, result: Any = None, error: Exception | None = None):
        self.result = result
        self.error = error
        self.calls: list[tuple[str, Any]] = []

    async def request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        self.calls.append((method, params))
        if self.error is not None:
            raise self.error
        return self.result


def plugin_with(backend: StubBackend) -> Any:
    plugin = main.Plugin()
    plugin.backend = backend
    return plugin


@contextlib.contextmanager
def machine_name(machine: str):
    """Stubs `platform.machine()` around the block, for `_main`'s engine pick."""
    real_machine = main.platform.machine
    main.platform.machine = lambda: machine
    try:
        yield
    finally:
        main.platform.machine = real_machine


class RpcEnvelopeTests(unittest.TestCase):
    def test_result_passes_through(self) -> None:
        backend = StubBackend(result={"addons": []})
        out = asyncio.run(plugin_with(backend)._rpc("addons.list"))
        self.assertEqual(out, {"addons": []})
        self.assertEqual(backend.calls, [("addons.list", None)])

    def test_engine_error_is_returned_not_raised(self) -> None:
        backend = StubBackend(error=main.BackendError("not_found", "Addon not found"))
        out = asyncio.run(plugin_with(backend)._rpc("addons.update", {"addonId": "x"}))
        self.assertEqual(out, {"__error": {"code": "not_found", "message": "Addon not found"}})

    def test_get_status_reports_a_dead_engine(self) -> None:
        backend = StubBackend(error=main.BackendError("engine_unavailable", "gone"))
        out = asyncio.run(plugin_with(backend).get_status())
        self.assertEqual(out, {"ok": False, "code": "engine_unavailable", "message": "gone"})

    def test_get_status_merges_the_engine_status(self) -> None:
        backend = StubBackend(result={"backendVersion": "0.1.0", "protocolVersion": 1, "pid": 7})
        out = asyncio.run(plugin_with(backend).get_status())
        self.assertEqual(out, {"ok": True, "backendVersion": "0.1.0", "protocolVersion": 1, "pid": 7})


class RpcForwarderTests(unittest.TestCase):
    def test_forwards_method_and_params_unchanged(self) -> None:
        backend = StubBackend(result={"addon": {"id": "x"}})
        params = {"providerId": "Curse", "externalId": "1", "channel": "beta"}
        out = asyncio.run(plugin_with(backend).rpc("addons.install", params))
        self.assertEqual(out, {"addon": {"id": "x"}})
        self.assertEqual(backend.calls, [("addons.install", params)])

    def test_no_params(self) -> None:
        backend = StubBackend(result={"addons": []})
        asyncio.run(plugin_with(backend).rpc("addons.list"))
        self.assertEqual(backend.calls, [("addons.list", None)])

    def test_engine_error_becomes_an_envelope(self) -> None:
        backend = StubBackend(error=main.BackendError("method_not_found", "Unknown method: nope"))
        out = asyncio.run(plugin_with(backend).rpc("nope", {}))
        self.assertEqual(out, {"__error": {"code": "method_not_found", "message": "Unknown method: nope"}})

    def test_non_string_method_is_refused_without_a_call(self) -> None:
        backend = StubBackend(result={})
        out = asyncio.run(plugin_with(backend).rpc(42, {}))  # type: ignore[arg-type]
        self.assertEqual(out["__error"]["code"], "invalid_request")
        self.assertEqual(backend.calls, [])


class EngineSelectionTests(unittest.TestCase):
    """At load the bridge picks the engine binary from the machine name
    (`uname -m`) and logs both."""

    def load_on(self, machine: str) -> tuple[Any, list[str]]:
        with machine_name(machine), self.assertLogs(_decky.logger, level="INFO") as logs:
            plugin = main.Plugin()
            asyncio.run(plugin._main())
        return plugin, logs.output

    def test_x86_64_selects_the_x86_64_engine(self) -> None:
        plugin, _ = self.load_on("x86_64")
        self.assertEqual(plugin.backend.binary_path, "/nonexistent/bin/wowdeck-x86_64")

    def test_aarch64_selects_the_aarch64_engine(self) -> None:
        plugin, _ = self.load_on("aarch64")
        self.assertEqual(plugin.backend.binary_path, "/nonexistent/bin/wowdeck-aarch64")

    def test_arm64_selects_the_aarch64_engine(self) -> None:
        plugin, _ = self.load_on("arm64")
        self.assertEqual(plugin.backend.binary_path, "/nonexistent/bin/wowdeck-aarch64")

    def test_an_unknown_machine_selects_no_engine(self) -> None:
        plugin, _ = self.load_on("riscv64")
        self.assertIsNone(plugin.backend)

    def test_the_log_names_the_machine_and_the_engine(self) -> None:
        _, logs = self.load_on("aarch64")
        self.assertIn(f"INFO:{_decky.logger.name}:Machine aarch64: engine binary wowdeck-aarch64", logs)


class UnsupportedMachineTests(unittest.TestCase):
    """A machine with no engine binary: every call answers
    unsupported_architecture, and no process is ever spawned."""

    def plugin_on(self, machine: str) -> Any:
        with machine_name(machine):
            plugin = main.Plugin()
            asyncio.run(plugin._main())
        return plugin

    def test_get_status_names_the_machine(self) -> None:
        plugin = self.plugin_on("riscv64")
        out = asyncio.run(plugin.get_status())
        self.assertEqual(
            out,
            {
                "ok": False,
                "code": "unsupported_architecture",
                "message": "WoWDeck doesn't run on riscv64 devices.",
            },
        )

    def test_a_forwarded_rpc_returns_the_same_envelope(self) -> None:
        plugin = self.plugin_on("riscv64")
        out = asyncio.run(plugin.rpc("addons.list"))
        self.assertEqual(
            out,
            {
                "__error": {
                    "code": "unsupported_architecture",
                    "message": "WoWDeck doesn't run on riscv64 devices.",
                }
            },
        )

    def test_calls_spawn_nothing(self) -> None:
        plugin = self.plugin_on("riscv64")
        asyncio.run(plugin.get_status())
        asyncio.run(plugin.rpc("addons.list"))
        self.assertIsNone(plugin.backend)


class SystemEnvironTest(unittest.TestCase):
    """The engine gets the system's library path, not PyInstaller's."""

    def run_frozen(self, environ: dict[str, str], frozen: bool = True) -> dict[str, str]:
        saved_env, saved_frozen = dict(main.os.environ), getattr(sys, "frozen", None)
        main.os.environ.clear()
        main.os.environ.update(environ)
        sys.frozen = frozen  # type: ignore[attr-defined]
        try:
            return main._system_environ()
        finally:
            main.os.environ.clear()
            main.os.environ.update(saved_env)
            if saved_frozen is None:
                del sys.frozen  # type: ignore[attr-defined]
            else:
                sys.frozen = saved_frozen  # type: ignore[attr-defined]

    def test_bundle_path_dropped_when_there_was_none(self) -> None:
        env = self.run_frozen({"LD_LIBRARY_PATH": "/tmp/_MEI123", "PATH": "/usr/bin"})
        self.assertNotIn("LD_LIBRARY_PATH", env)
        self.assertEqual(env["PATH"], "/usr/bin")

    def test_earlier_path_restored(self) -> None:
        env = self.run_frozen({"LD_LIBRARY_PATH": "/tmp/_MEI123", "LD_LIBRARY_PATH_ORIG": "/opt/lib"})
        self.assertEqual(env["LD_LIBRARY_PATH"], "/opt/lib")
        self.assertNotIn("LD_LIBRARY_PATH_ORIG", env)

    def test_left_alone_when_not_frozen(self) -> None:
        env = self.run_frozen({"LD_LIBRARY_PATH": "/opt/lib"}, frozen=False)
        self.assertEqual(env["LD_LIBRARY_PATH"], "/opt/lib")



class EnsureExecutableTest(unittest.TestCase):
    """Decky's installer drops file modes; the engine must still start."""

    def binary(self, mode: int) -> str:
        fd, path = tempfile.mkstemp()
        os.close(fd)
        os.chmod(path, mode)
        self.addCleanup(os.remove, path)
        return path

    def test_restores_the_execute_bit_the_installer_dropped(self) -> None:
        path = self.binary(0o600)  # as Decky left it on DroidDeck (DEVICE 2026-10-31)
        main._ensure_executable(path)
        self.assertTrue(os.access(path, os.X_OK))
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o711)

    def test_leaves_an_executable_binary_alone(self) -> None:
        path = self.binary(0o755)
        main._ensure_executable(path)
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o755)

    def test_a_missing_binary_is_left_to_the_start_to_report(self) -> None:
        main._ensure_executable("/nonexistent/wowdeck")

if __name__ == "__main__":
    unittest.main()
