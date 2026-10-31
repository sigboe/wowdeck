"""WoWDeck Addon Manager for Decky.

Thin Decky plugin backend. All addon management logic lives in the standalone
`wowdeck` engine binary which is spawned and supervised from here.
Communication is newline-delimited JSON (JSONL) over the child process
stdin/stdout.

Protocol (see backend/src/api/contracts.ts):

  request  -> {"id": 1, "method": "addons.list", "params": {...}}\\n
  response <- {"id": 1, "result": {...}}\\n
             {"id": 1, "error": {"code": "...", "message": "..."}}\\n
  event    <- {"event": "operation.completed", "params": {...}}\\n

Events are relayed to the frontend via decky.emit("backend_event", payload).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import sys
import time
from typing import Any

import decky

BIN_NAME = "wowdeck"
START_TIMEOUT = 10.0
REQUEST_TIMEOUT = 120.0
RESTART_MIN_DELAY = 1.0
RESTART_MAX_DELAY = 30.0
# Largest single JSON line accepted from the engine (asyncio default: 64 KiB).
ENGINE_LINE_LIMIT = 16 * 1024 * 1024

# The one generated runtime resource tools/package.py writes next to the
# engine binary when an authorized key was available at build time (a CI
# secret, or a local file literally named CURSEFORGE_API_KEY at the repo
# root — gitignored, holding only the key this project is authorized to
# ship). Absent in a fork/dev build that had neither — a fully supported,
# no-crash configuration (the engine falls back to a user-provided key,
# same as always). Never logged, never echoed — only whether it was found.
CURSEFORGE_KEY_RESOURCE_NAME = "bundled-curseforge-key"


def _read_bundled_curseforge_key() -> str | None:
    """Reads the packaged resource without ever logging its contents."""
    path = os.path.join(decky.DECKY_PLUGIN_DIR, "bin", CURSEFORGE_KEY_RESOURCE_NAME)
    try:
        with open(path, "r", encoding="utf-8") as f:
            value = f.read().strip()
    except OSError:
        return None
    return value or None


def _system_environ() -> dict[str, str]:
    """os.environ as the system set it, for the engine and what it runs.

    Decky Loader is a PyInstaller bundle: it points LD_LIBRARY_PATH at its
    own unpacked libraries (/tmp/_MEI...) and keeps any earlier value in
    LD_LIBRARY_PATH_ORIG. Inherited, that makes the system programs the
    engine starts load the bundle's libraries; SteamOS's 7z (a /bin/sh
    wrapper) then fails on a libc mismatch (DEVICE 2026-10-22). The restore
    is PyInstaller's documented one, and only when running frozen.
    """
    env = dict(os.environ)
    if getattr(sys, "frozen", False):
        original = env.pop("LD_LIBRARY_PATH_ORIG", None)
        if original is None:
            env.pop("LD_LIBRARY_PATH", None)
        else:
            env["LD_LIBRARY_PATH"] = original
    return env


class BackendError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message


class BackendProcess:
    """Supervises the engine binary and implements the JSONL client."""

    def __init__(self, binary_path: str):
        self.binary_path = binary_path
        self.proc: asyncio.subprocess.Process | None = None
        self._next_id = 1
        self._pending: dict[int, asyncio.Future[Any]] = {}
        self._reader_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._last_start = 0.0
        self._stopping = False
        self.status: dict[str, Any] | None = None

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def ensure_started(self) -> None:
        async with self._lock:
            if self.running:
                return
            now = time.monotonic()
            since_last = now - self._last_start
            if since_last < RESTART_MIN_DELAY:
                await asyncio.sleep(RESTART_MIN_DELAY - since_last)
            self._last_start = time.monotonic()
            decky.logger.info("Starting engine binary: %s", self.binary_path)
            runtime_dir = getattr(decky, "DECKY_PLUGIN_RUNTIME_DIR", None)
            data_dir = runtime_dir or os.path.join(decky.DECKY_PLUGIN_DIR, "data")
            os.makedirs(data_dir, exist_ok=True)
            env = {
                **_system_environ(),
                "WOWDECK_CHILD": "1",
                "WOWDECK_DATA_DIR": data_dir,
                # The installed plugin folder: about.get reads the bundled
                # THIRD_PARTY_NOTICES.md from it.
                "WOWDECK_PLUGIN_DIR": decky.DECKY_PLUGIN_DIR,
                "HOME": decky.DECKY_USER_HOME,
            }
            # Forwarded as a plain env var rather than leaving the engine to
            # read the file itself, so the engine binary has no filesystem-
            # path assumptions about its own install location baked in — it
            # already takes every other piece of runtime config this same
            # way (WOWDECK_DATA_DIR above, WOWDECK_CHILD, ...).
            bundled_key = _read_bundled_curseforge_key()
            if bundled_key:
                env["WOWDECK_BUNDLED_CURSEFORGE_API_KEY"] = bundled_key
            self.proc = await asyncio.create_subprocess_exec(
                self.binary_path,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                # One JSON message per line; addon descriptions and changelogs
                # are long HTML. asyncio's default 64 KiB line limit made
                # readline() raise on one, which ended the reader while the
                # engine kept running, so every later request timed out.
                limit=ENGINE_LINE_LIMIT,
            )
            self._reader_task = asyncio.create_task(self._read_stdout())
            self._stderr_task = asyncio.create_task(self._read_stderr())

    async def _read_stdout(self) -> None:
        proc = self.proc
        assert proc is not None and proc.stdout is not None
        try:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    decky.logger.warning("Engine sent invalid JSON: %.200s", line)
                    continue
                if "id" in msg and (msg.get("result") is not None or "error" in msg):
                    self._resolve(msg)
                elif "event" in msg:
                    await decky.emit("backend_event", msg)
                else:
                    decky.logger.warning("Engine sent unexpected message: %.200s", line)
        except (ValueError, asyncio.LimitOverrunError) as exc:
            decky.logger.error("Engine output could not be read: %s", exc)
        finally:
            self._fail_all_pending("engine_exited", "Engine process exited")
            if not self._stopping and self.proc is not None and self.proc.returncode is None:
                # Nobody reads its output any more: stop it so the next call
                # starts a fresh engine instead of timing out forever.
                decky.logger.warning("Engine stdout closed unexpectedly; stopping the engine")
                try:
                    self.proc.kill()
                except ProcessLookupError:
                    pass

    async def _read_stderr(self) -> None:
        proc = self.proc
        assert proc is not None and proc.stderr is not None
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").rstrip()
            if text:
                decky.logger.info("[engine] %s", text)

    def _resolve(self, msg: dict[str, Any]) -> None:
        fut = self._pending.pop(msg["id"], None)
        if fut is None or fut.done():
            return
        if "error" in msg:
            err = msg["error"] or {}
            fut.set_exception(
                BackendError(str(err.get("code", "unknown")), str(err.get("message", "unknown error")))
            )
        else:
            fut.set_result(msg.get("result"))

    def _fail_all_pending(self, code: str, message: str) -> None:
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(BackendError(code, message))
        self._pending.clear()

    async def request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        await self.ensure_started()
        proc = self.proc
        assert proc is not None and proc.stdin is not None
        msg_id = self._next_id
        self._next_id += 1
        fut: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[msg_id] = fut
        payload = json.dumps({"id": msg_id, "method": method, "params": params or {}}, ensure_ascii=False)
        try:
            proc.stdin.write((payload + "\n").encode("utf-8"))
            await proc.stdin.drain()
            return await asyncio.wait_for(fut, REQUEST_TIMEOUT)
        except (BrokenPipeError, ConnectionResetError):
            self._pending.pop(msg_id, None)
            raise BackendError("engine_unavailable", "Engine process is not responding") from None
        except TimeoutError:
            self._pending.pop(msg_id, None)
            raise BackendError("timeout", f"Request {method} timed out") from None

    async def stop(self) -> None:
        self._stopping = True
        proc = self.proc
        for task in (self._reader_task, self._stderr_task):
            if task is not None:
                task.cancel()
        self._reader_task = None
        self._stderr_task = None
        self._fail_all_pending("engine_stopped", "Engine stopped")
        if proc is not None and proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), 5.0)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
                await proc.wait()
        self.proc = None


# Plenty for an addon list export string (CurseForge ids + names for a
# very large addon list); guards read_text_file/save_text_file against
# an unrelated huge file.
MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024


class Plugin:
    backend: BackendProcess | None = None

    async def _main(self):
        # Self-heal a reload that skipped `_unload` (seen with some
        # Decky Loader plugin-update paths, which can re-run `_main`
        # without reliably calling `_unload` first): without this, the
        # previous engine subprocess would be orphaned — still holding
        # its own binary open — rather than stopped, which is exactly
        # the condition that makes a *subsequent* file overwrite of that
        # same still-running binary fail with ETXTBSY ("text file
        # busy"). Stopping whatever is already running before replacing
        # `self.backend` means a stray process never survives a reload.
        if self.backend is not None:
            await self.backend.stop()
        binary = os.path.join(decky.DECKY_PLUGIN_DIR, "bin", BIN_NAME)
        self.backend = BackendProcess(binary)
        decky.logger.info("WoWDeck Addon Manager loaded (plugin dir: %s)", decky.DECKY_PLUGIN_DIR)

    async def _unload(self):
        if self.backend is not None:
            await self.backend.stop()
        decky.logger.info("WoWDeck Addon Manager unloaded")

    async def _uninstall(self):
        if self.backend is not None:
            await self.backend.stop()

    # ---- RPC surface (called from the frontend via @decky/api) ----

    async def _rpc(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Engine call whose failure is returned, not raised.

        Decky replaces any exception raised by a plugin method with the
        generic text "Python Exception" before it reaches the frontend, so
        the engine's real message would be lost. A failure is returned as
        {"__error": {"code", "message"}} and rethrown by src/services/backend.ts.
        """
        try:
            return await self.backend.request(method, params)
        except BackendError as exc:
            return {"__error": {"code": exc.code, "message": exc.message}}

    async def rpc(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Forward any engine method unchanged (contracts.ts MethodMap).

        The engine answers an unknown method with method_not_found. A
        non-string method is refused here: the engine would drop the line
        and the call would wait for the request timeout.
        """
        if not isinstance(method, str):
            return {"__error": {"code": "invalid_request", "message": "method must be a string"}}
        return await self._rpc(method, params)

    async def get_status(self) -> dict[str, Any]:
        """Backend health probe. Never raises for a dead engine."""
        try:
            result = await self.backend.request("system.getStatus")
            return {"ok": True, **result}
        except BackendError as exc:
            return {"ok": False, "code": exc.code, "message": exc.message}

    async def read_text_file(self, path: str) -> dict[str, Any]:
        """Reads a small text file the user explicitly picked via Decky's
        own openFilePicker — Import Addon List's "load from file" option.
        Pure filesystem I/O, so this lives here rather than round-
        tripping through the engine."""
        try:
            if not os.path.isfile(path):
                return {"ok": False, "content": None, "message": "not a file"}
            if os.path.getsize(path) > MAX_TEXT_FILE_BYTES:
                return {"ok": False, "content": None, "message": "file is too large"}
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                return {"ok": True, "content": f.read(), "message": ""}
        except OSError as exc:
            return {"ok": False, "content": None, "message": str(exc)}

    async def save_text_file(self, directory: str, filename: str, content: str) -> dict[str, Any]:
        """Writes `content` as a new file named `filename` inside
        `directory` (the folder the user picked via openFilePicker) for
        Export Addon List's "Save to file". Never overwrites an existing
        file: if `filename` is already taken, appends " (n)" before the
        extension and retries, incrementing n — the same convention
        GNOME/KDE file managers use when saving a file that would
        otherwise collide."""
        try:
            if not os.path.isdir(directory):
                return {"ok": False, "path": None, "message": "not a directory"}
            if len(content) > MAX_TEXT_FILE_BYTES:
                return {"ok": False, "path": None, "message": "export is too large to save"}
            safe_name = os.path.basename(filename.strip()) or "wowdeck-addons-export.txt"
            stem, ext = os.path.splitext(safe_name)
            candidate = os.path.join(directory, safe_name)
            n = 1
            while os.path.exists(candidate):
                candidate = os.path.join(directory, f"{stem} ({n}){ext}")
                n += 1
            with open(candidate, "w", encoding="utf-8") as f:
                f.write(content)
            return {"ok": True, "path": candidate, "message": ""}
        except OSError as exc:
            return {"ok": False, "path": None, "message": str(exc)}
