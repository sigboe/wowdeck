"""Bounded, read-only log queries. Called over one isolated SSH connection."""
import base64
import json
from pathlib import Path
import re
import sys
import time

options = json.loads(base64.b64decode(sys.argv[1]))
root = Path.home() / 'homebrew/logs/wowdeck'
pattern = re.compile(options.get('pattern') or '', re.I)
limit = options.get('lines', 30)
# Bound both memory and the amount returned through SSH.
cap = 65536

def files():
    return sorted(root.glob('*.log'), key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)[:10]

if options['mode'] == 'mark':
    print(json.dumps({str(p): [p.stat().st_ino, p.stat().st_size] for p in files()}))
    sys.exit(0)

checkpoint = options.get('checkpoint')
until = time.monotonic() + options.get('timeout', 0) / 1000
while True:
    paths = files()
    if checkpoint is None:
        paths = paths[:1]
    matches = []
    for p in reversed(paths):
        with p.open('rb') as f:
            stat = p.stat()
            old = next((v for v in (checkpoint or {}).values() if v[0] == stat.st_ino), None)
            start = old[1] if old and old[0] == stat.st_ino and old[1] <= stat.st_size else 0
            f.seek(max(start, stat.st_size - cap))
            if f.tell() > start:
                f.readline()  # discard the partial first line
            matches.extend(line[:1000] for line in f.read(cap).decode('utf-8', errors='replace').splitlines() if pattern.search(line))
    if matches or options['mode'] != 'wait':
        print(json.dumps(matches[-limit:]))
        break
    if time.monotonic() >= until:
        print('no matching log line before timeout', file=sys.stderr)
        sys.exit(1)
    time.sleep(min(0.2, max(0, until - time.monotonic())))
