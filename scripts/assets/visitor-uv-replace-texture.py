"""未圧縮GLBの4Kベースカラーだけを余白拡張済みPNGに交換する。

Python 3の標準ライブラリのみを使用。元GLBとPNGは上書きしない。
例: python3 scripts/assets/visitor-uv-replace-texture.py /tmp/visitor-uv.glb /tmp/visitor-basecolor-padded.png /tmp/visitor-uv-padded.glb
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('texture', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
paths = [args.source.resolve(), args.texture.resolve(), args.output.resolve()]
if len(set(paths)) != len(paths):
    raise ValueError('入力GLB・PNG・出力GLBは別のパスにしてください')
raw = args.source.read_bytes()
png = args.texture.read_bytes()
if hashlib.sha256(raw).hexdigest() != '0dacbd1d8001c435d7d42335c6099a02456104abafc82324f0f9050ca6f9a867':
    raise ValueError('入力GLBが検証済みの再生成データと一致しません')
if hashlib.sha256(png).hexdigest() != '4ce4854b643ae59884248a7a3a1fd03e13009b5c1837d9bacfcb0dc68b456392':
    raise ValueError('PNGが検証済みの余白拡張画像と一致しません')
if len(raw) < 28 or raw[:4] != b'glTF':
    raise ValueError('GLBではありません')
magic, version, total = struct.unpack_from('<III', raw, 0)
json_len, json_type = struct.unpack_from('<II', raw, 12)
json_start, json_end = 20, 20 + json_len
if version != 2 or total != len(raw) or json_type != 0x4E4F534A or json_end + 8 > len(raw):
    raise ValueError('GLBのヘッダーが不正です')
bin_len, bin_type = struct.unpack_from('<II', raw, json_end)
if bin_type != 0x004E4942 or json_end + 8 + bin_len != len(raw):
    raise ValueError('単一BINチャンクのGLBが必要です')
doc = json.loads(raw[json_start:json_end])
if len(doc.get('buffers', [])) != 1 or doc['buffers'][0].get('uri'):
    raise ValueError('埋め込みバッファ1つのGLBが必要です')
images = [i for i in doc.get('images', []) if i.get('name') == 'visitor-basecolor-4k']
if len(images) != 1 or images[0].get('mimeType') != 'image/png' or 'bufferView' not in images[0]:
    raise ValueError('交換対象の4K画像を一意に特定できません')
view_index = images[0]['bufferView']
views = doc['bufferViews']
view = views[view_index]
if view.get('buffer', 0) != 0:
    raise ValueError('4K画像のバッファが不正です')
start = view.get('byteOffset', 0)
length = view['byteLength']
end = (start + length + 3) & ~3
binary = raw[json_end + 8:]
if start % 4 or end > len(binary) or hashlib.sha256(binary[start:start + length]).hexdigest() != '0698fc4dae37e7cb5f6443b9e1febf327d292208568377f16c2dfb3aaf7c7815':
    raise ValueError('埋め込み元の4K画像が一致しません')
for i, other in enumerate(views):
    if i == view_index or other.get('buffer', 0) != 0:
        continue
    other_start = other.get('byteOffset', 0)
    other_end = other_start + other['byteLength']
    if other_start < end and other_end > start:
        raise ValueError('別のバッファ領域が画像と重なっています')

padded_png = png + b'\0' * (-len(png) % 4)
delta = len(padded_png) - (end - start)
view['byteLength'] = len(png)
for i, other in enumerate(views):
    if i != view_index and other.get('buffer', 0) == 0 and other.get('byteOffset', 0) >= end:
        other['byteOffset'] = other.get('byteOffset', 0) + delta
binary = binary[:start] + padded_png + binary[end:]
doc['buffers'][0]['byteLength'] += delta
encoded = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
encoded += b' ' * (-len(encoded) % 4)
result = (struct.pack('<III', magic, 2, 12 + 8 + len(encoded) + 8 + len(binary))
          + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
          + struct.pack('<II', len(binary), 0x004E4942) + binary)
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_bytes(result)
print('4Kベースカラーのみを交換しました:', args.output)
