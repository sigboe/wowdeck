"""Offline tests through the recovery staging interface."""
import asyncio
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from recovery_updater import stage

FIXTURES = Path(__file__).resolve().parent.parent / 'tests/fixtures/recovery-packages'

class Response(io.BytesIO):
    headers = {}

class RecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_packages(self):
        for case in json.loads((FIXTURES / 'cases.json').read_text()):
            with self.subTest(case=case['file']), tempfile.TemporaryDirectory() as directory:
                data = (FIXTURES / case['file']).read_bytes()
                with patch('urllib.request.OpenerDirector.open', return_value=Response(data)):
                    if case['valid']:
                        result = await stage('https://example.invalid/release', '0.2.0', 'sha256:' + hashlib.sha256(data).hexdigest(), temp_dir=directory)
                        self.assertEqual(Path(result['path']).read_bytes(), data)
                        self.assertEqual(Path(result['path']).stat().st_mode & 0o777, 0o600)
                    else:
                        with self.assertRaises(ValueError):
                            await stage('https://example.invalid/release', '0.2.0', hashlib.sha256(data).hexdigest(), temp_dir=directory)
                        self.assertEqual(list(Path(directory).iterdir()), [])

    async def test_version_conformance_table(self):
        table = json.loads((FIXTURES.parents[2] / 'backend/src/api/version-table.json').read_text())
        for row in table['versions']:
            with self.subTest(version=row['text']), tempfile.TemporaryDirectory() as directory:
                output = io.BytesIO()
                with zipfile.ZipFile(FIXTURES / 'good.zip') as source, zipfile.ZipFile(output, 'w') as target:
                    for name in source.namelist():
                        target.writestr(name, json.dumps({'name': 'WoWDeck', 'version': row['text']}) if name == 'wowdeck/plugin.json' else source.read(name))
                data = output.getvalue()
                with patch('urllib.request.OpenerDirector.open', return_value=Response(data)):
                    if row['writes']:
                        result = await stage('https://example.invalid', row['text'], hashlib.sha256(data).hexdigest(), temp_dir=directory)
                        self.assertEqual(result['version'], row['text'])
                    else:
                        with self.assertRaises(ValueError):
                            await stage('https://example.invalid', row['text'], hashlib.sha256(data).hexdigest(), temp_dir=directory)
                        self.assertEqual(list(Path(directory).iterdir()), [])

    async def test_failed_downloads_leave_no_output_or_secret_error(self):
        data = (FIXTURES / 'good.zip').read_bytes()
        for response, digest in [(Response(data), '0' * 64), (Response(data[:20]), hashlib.sha256(data).hexdigest())]:
            with tempfile.TemporaryDirectory() as directory:
                with patch('urllib.request.OpenerDirector.open', return_value=response):
                    with self.assertRaisesRegex(ValueError, '^Recovery update could not be staged$'):
                        await stage('https://example.invalid/?key=SECRET', '0.2.0', digest, temp_dir=directory)
                self.assertEqual(list(Path(directory).iterdir()), [])
        with patch('urllib.request.OpenerDirector.open', side_effect=OSError('token=SECRET')):
            with self.assertRaisesRegex(ValueError, '^Recovery update could not be staged$'):
                await stage('https://example.invalid', '0.2.0', '0' * 64)

    async def test_length_size_and_timeout_cleanup(self):
        data = (FIXTURES / 'good.zip').read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        for limit, length in [(1, None), (len(data), str(len(data) + 1))]:
            response = Response(data)
            response.headers = {} if length is None else {'Content-Length': length}
            with tempfile.TemporaryDirectory() as directory:
                with patch('urllib.request.OpenerDirector.open', return_value=response), patch('recovery_updater.MAX_BYTES', limit):
                    with self.assertRaises(ValueError):
                        await stage('https://example.invalid', '0.2.0', digest, temp_dir=directory)
                self.assertEqual(list(Path(directory).iterdir()), [])
        with patch('urllib.request.OpenerDirector.open', side_effect=TimeoutError):
            with self.assertRaises(ValueError):
                await stage('https://example.invalid', '0.2.0', digest)

    async def test_cancel_waits_for_worker_cleanup(self):
        import threading
        entered = threading.Event()
        release = threading.Event()
        data = (FIXTURES / 'good.zip').read_bytes()
        def download(*args, **kwargs):
            entered.set()
            if not release.wait(5):
                raise RuntimeError('test worker timed out')
            return Response(data)
        with tempfile.TemporaryDirectory() as directory:
            with patch('urllib.request.OpenerDirector.open', side_effect=download):
                pending = asyncio.create_task(stage('https://example.invalid', '0.2.0', hashlib.sha256(data).hexdigest(), temp_dir=directory))
                try:
                    self.assertTrue(await asyncio.to_thread(entered.wait, 5))
                    pending.cancel()
                    await asyncio.sleep(0)
                finally:
                    release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await pending
                self.assertEqual(list(Path(directory).iterdir()), [])

    async def test_download_does_not_block_event_loop(self):
        import threading
        entered = threading.Event()
        release = threading.Event()
        data = (FIXTURES / 'good.zip').read_bytes()
        def download(*args, **kwargs):
            entered.set()
            if not release.wait(5):
                raise RuntimeError('test worker timed out')
            return Response(data)
        with tempfile.TemporaryDirectory() as directory:
            with patch('urllib.request.OpenerDirector.open', side_effect=download):
                pending = asyncio.create_task(stage('https://example.invalid', '0.2.0', hashlib.sha256(data).hexdigest(), temp_dir=directory))
                try:
                    self.assertTrue(await asyncio.to_thread(entered.wait, 5))
                    self.assertFalse(pending.done())
                finally:
                    release.set()
                await pending

if __name__ == '__main__':
    unittest.main()
