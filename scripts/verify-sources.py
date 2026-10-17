#!/usr/bin/env python3
"""Verify the exact upstream snapshots. Does not replace application catalogs."""
import hashlib
import json
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parent.parent
sources = json.loads((root / 'scripts/catalogs/sources.json').read_text())
cache = root / '.cache/catalogs'
cache.mkdir(parents=True, exist_ok=True)
for name, source in sources.items():
    with urllib.request.urlopen(source['url'], timeout=60) as response:
        data = response.read()
    actual = hashlib.sha256(data).hexdigest()
    if actual != source['sha256']:
        raise RuntimeError(f'{name}: SHA-256 mismatch; stop without changing expected hashes')
    (cache / name).write_bytes(data)
    print(f'OK {name}: {actual}')
