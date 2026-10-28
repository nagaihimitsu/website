"""選択したUV編集版から、配信用の未圧縮GLBを別名で生成する。

Blender 4.3.2を使用する。元のblendファイルは保存せず、配信に不要な
中間UVだけをメモリ内で外す。出力先が既に存在する場合は上書きしない。

  blender -b -t 4 --python-exit-code 1 \\
    --python scripts/assets/visitor-uv-selected-export.py -- \\
    /path/to/visitor-uv-editable-padded.blend /tmp/visitor-selected-raw.glb
"""
import argparse
import hashlib
import os
from pathlib import Path
import sys
import tempfile

import bpy

SOURCE_SHA256 = 'e97d5b28170e7f1978c66cb480c7784de765aafe0016f12c54690e8553fd97d9'


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path, help='検証済みの選択UV編集版blend')
parser.add_argument('output', type=Path, help='未圧縮GLBの新規出力先')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
source = args.source.resolve(strict=True)
output = args.output.resolve()
if source == output:
    raise ValueError('入力と出力には別々のパスを指定してください')
if output.suffix.lower() != '.glb':
    raise ValueError('出力先には.glbを指定してください')
if output.exists():
    raise FileExistsError(f'既存ファイルは上書きしません: {output}')
if digest(source) != SOURCE_SHA256:
    raise ValueError('入力blendが検証済みの選択UV編集版と一致しません')
if bpy.app.version[:2] != (4, 3):
    raise ValueError('検証済みのBlender 4.3系を使用してください')
output.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(source))
obj = bpy.data.objects.get('VisitorMesh')
if not obj or obj.type != 'MESH':
    raise ValueError('検証済みNPCメッシュが見つかりません')
mesh = obj.data
if [layer.name for layer in mesh.uv_layers] != ['UVMap', 'UV_Editable', 'UV_Editable_2']:
    raise ValueError('想定した3つのUVレイヤーが見つかりません')
if not mesh.uv_layers.active or mesh.uv_layers.active.name != 'UV_Editable_2':
    raise ValueError('選択UVが想定と異なります')
# 保存しない作業コピーで中間UVだけを削除する。色はUV_Editable_2、
# ノーマル・質感はUVMapを参照し、GLBのテクスチャ座標を2層に保つ。
mesh.uv_layers.remove(mesh.uv_layers['UV_Editable'])
mesh.uv_layers.active = mesh.uv_layers['UV_Editable_2']
mesh.uv_layers.active.active_render = True
bpy.context.scene.frame_set(1)

with tempfile.TemporaryDirectory(prefix='.visitor-uv-export-', dir=output.parent) as temporary:
    staged = Path(temporary) / 'visitor-selected-raw.glb'
    # ベースカラーには頂点色が転写済みなので、二重乗算を避ける。
    bpy.ops.export_scene.gltf(
        filepath=str(staged), export_format='GLB',
        export_animations=True, export_animation_mode='NLA_TRACKS',
        export_skins=True, export_apply=False, export_image_format='AUTO',
        export_force_sampling=True, export_texcoords=True, export_vertex_color='NONE',
    )
    if not staged.is_file() or staged.stat().st_size == 0:
        raise RuntimeError('GLBの生成に失敗しました')
    # ハードリンクは出力先が既に存在すると失敗し、他のファイルを上書きしない。
    os.link(staged, output)
if digest(source) != SOURCE_SHA256:
    raise RuntimeError('入力blendの内容が作業中に変更されました')
print('未圧縮GLBを出力しました:', output)
print('SHA-256:', digest(output))
