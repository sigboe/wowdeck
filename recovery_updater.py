"""Stage a verified recovery package without the engine or engine settings.

The caller supplies release metadata. All blocking work stays in a worker;
errors deliberately contain no network exception text or request URLs.
"""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import tempfile
import time
import urllib.request
import urllib.parse
import zipfile

MAX_BYTES = 256 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
SOCKET_TIMEOUT = 10
DEADLINE = 120
VERSION = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:beta|test)\.[1-9][0-9]*|-pr\.[1-9][0-9]*(?:\.(?:[2-9]|[1-9][0-9]+))?)?')


class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlparse(newurl).scheme != 'https':
            raise ValueError('Recovery download requires HTTPS')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def tls_context():
    """Prefer the system trust store; use Decky's certifi when unavailable."""
    context = ssl.create_default_context()
    if not context.get_ca_certs():
        try:
            import certifi
            context.load_verify_locations(cafile=certifi.where())
        except ImportError:
            raise ValueError('No recovery TLS trust store available') from None
    return context


def _validate(path, version, deadline):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(entry.file_size for entry in entries) > MAX_EXPANDED:
            raise ValueError('Recovery package exceeds limits')
        names = [entry.filename.replace('\\', '/') for entry in entries]
        if len(names) != len(set(names)) or any('..' in name for name in names):
            raise ValueError('Invalid recovery package layout')
        required = {'wowdeck/plugin.json', 'wowdeck/package.json', 'wowdeck/main.py', 'wowdeck/dist/index.js'}
        engines = {'wowdeck/bin/wowdeck', 'wowdeck/bin/wowdeck-x86_64'}
        if not required.issubset(names) or not engines.intersection(names):
            raise ValueError('Incomplete recovery package')
        # Read all members to check CRCs, without extracting or executing them.
        for entry in entries:
            with archive.open(entry) as member:
                while member.read(65536):
                    if time.monotonic() > deadline:
                        raise ValueError('Recovery staging timed out')
        manifest_entry = entries[names.index('wowdeck/plugin.json')]
        if manifest_entry.file_size > 65536:
            raise ValueError('Invalid recovery manifest')
        manifest = json.loads(archive.read(manifest_entry))
        if not isinstance(manifest, dict) or manifest.get('name') != 'WoWDeck' or manifest.get('version') != version:
            raise ValueError('Recovery package version mismatch')


def _stage(url, version, digest, temp_dir):
    partial = None
    try:
        if not VERSION.fullmatch(version) or not re.fullmatch(r'(?:sha256:)?[0-9a-f]{64}', digest):
            raise ValueError('Invalid recovery release metadata')
        if urllib.parse.urlparse(url).scheme != 'https':
            raise ValueError('Recovery download requires HTTPS')
        deadline = time.monotonic() + DEADLINE
        opener = urllib.request.build_opener(HTTPSRedirect(), urllib.request.HTTPSHandler(context=tls_context()))
        with tempfile.NamedTemporaryFile(prefix='.wowdeck-recovery-', dir=temp_dir, delete=False) as output:
            partial = output.name
            os.fchmod(output.fileno(), 0o600)
            hasher = hashlib.sha256()
            received = 0
            with opener.open(url, timeout=SOCKET_TIMEOUT) as response:
                length = response.headers.get('Content-Length')
                if length is not None and (int(length) < 0 or int(length) > MAX_BYTES):
                    raise ValueError('Recovery download exceeds limits')
                while True:
                    chunk = response.read1(65536)
                    if time.monotonic() > deadline:
                        raise ValueError('Recovery staging timed out')
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > MAX_BYTES:
                        raise ValueError('Recovery download exceeds limits')
                    hasher.update(chunk)
                    output.write(chunk)
                if length is not None and received != int(length):
                    raise ValueError('Incomplete recovery download')
            output.flush()
            os.fsync(output.fileno())
        sha256 = hasher.hexdigest()
        if sha256 != digest.removeprefix('sha256:'):
            raise ValueError('Recovery digest mismatch')
        _validate(partial, version, deadline)
        destination = partial + '.zip'
        os.replace(partial, destination)
        partial = None
        return {'path': destination, 'version': version, 'sha256': sha256}
    except Exception:
        raise ValueError('Recovery update could not be staged') from None
    finally:
        if partial is not None:
            Path(partial).unlink(missing_ok=True)


async def stage(url: str, version: str, digest: str, *, temp_dir=None):
    """Return path/version/sha256 after atomic staging to the OS temp directory.

    Cancellation waits for worker cleanup rather than abandoning a staged file.
    """
    worker = asyncio.create_task(asyncio.to_thread(_stage, url, version, digest, temp_dir))
    try:
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        try:
            result = await worker
            await asyncio.to_thread(Path(result['path']).unlink, missing_ok=True)
        except Exception:
            pass
        raise
