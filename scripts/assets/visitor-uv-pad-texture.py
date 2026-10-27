"""配信用4K色画像のUV島外へ最近傍の色を拡張する。

UV島内の画素は変更せず、縮小表示時の黒い継ぎ目を抑える。
使用環境: Python 3、NumPy 2.3.5、Pillow 12.3.0、SciPy 1.17.0。
例: python3 scripts/assets/visitor-uv-pad-texture.py /tmp/visitor-basecolor-4k.png /tmp/visitor-basecolor-padded.png
"""
import argparse
import hashlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--layout', type=Path, default=Path(__file__).with_name('visitor-uv-layout.npz'))
args = parser.parse_args()

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

if args.source.resolve() in {args.output.resolve(), args.layout.resolve()} or args.output.resolve() == args.layout.resolve():
    raise ValueError('入力・UV配置・出力は別のパスにしてください')
if digest(args.source) != '0698fc4dae37e7cb5f6443b9e1febf327d292208568377f16c2dfb3aaf7c7815':
    raise ValueError('入力画像が検証済みの4K色画像と一致しません')
if digest(args.layout) != '41cadfda9c0b6e4c8ccce6492db1e4833d7cb89430bad7ca4d076e6919f131ff':
    raise ValueError('UV配置データが検証済みのものと一致しません')
with Image.open(args.source) as source:
    if source.size != (4096, 4096) or source.format != 'PNG':
        raise ValueError('4096×4096のPNGが必要です')
    pixels = np.asarray(source.convert('RGBA'))
with np.load(args.layout, allow_pickle=False) as archive:
    uv = archive['uv']
if uv.shape != (654510, 2) or not np.isfinite(uv).all() or np.any(uv < 0) or np.any(uv > 1):
    raise ValueError('UV座標が検証済みの範囲と一致しません')
n = 4096
mask = Image.new('L', (n, n), 0)
draw = ImageDraw.Draw(mask)
for triangle in uv.reshape(-1, 3, 2):
    points = [(int(round(float(x) * (n - 1))), int(round((1 - float(y)) * (n - 1))))
              for x, y in triangle]
    draw.polygon(points, fill=255)
occupied = np.asarray(mask) > 0
if not occupied.any():
    raise ValueError('UV島が見つかりません')
nearest = distance_transform_edt(~occupied, return_distances=False, return_indices=True)
out = pixels[nearest[0], nearest[1]]
if not np.array_equal(out[occupied], pixels[occupied]):
    raise RuntimeError('UV島内の画素が変化しました')
args.output.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray(out).save(args.output, format='PNG', compress_level=4)
print(f'UV島内{int(occupied.sum())}画素を維持し、外側へ色を拡張: {args.output}')
