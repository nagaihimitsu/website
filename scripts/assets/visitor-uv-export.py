"""UV整理済みのNPCを再生成し、元色の4K画像と未圧縮GLBを出力する。

Blender 4.3.2 の Python を使用する。入力blend・既存UVは上書きしない。
例:
  blender -b -t 4 --python scripts/assets/visitor-uv-export.py -- \
    /path/to/visitor-original.blend /tmp/visitor-uv.glb \
    --texture /tmp/visitor-basecolor-4k.png --blend /tmp/visitor-uv.blend
"""
import argparse
import hashlib
import sys
from pathlib import Path

import bpy
import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path, help='検証済みのUV整理前Blenderファイル')
parser.add_argument('output', type=Path, help='未圧縮GLBの出力先')
parser.add_argument('--texture', type=Path, required=True, help='4KベースカラーPNGの出力先')
parser.add_argument('--blend', type=Path, help='UV整理後の編集用Blenderファイルの出力先')
parser.add_argument('--layout', type=Path, default=Path(__file__).with_name('visitor-uv-layout.npz'))
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

source_hash = 'aea54883c219ead48fc45d1e632944f2ccc8857a371844c694f508021690a9bc'
layout_hash = '41cadfda9c0b6e4c8ccce6492db1e4833d7cb89430bad7ca4d076e6919f131ff'
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

if digest(args.source) != source_hash:
    raise ValueError('入力blendが検証済みの元データと一致しません')
if digest(args.layout) != layout_hash:
    raise ValueError('UV配置データが検証済みのものと一致しません')
inputs = {args.source.resolve(), args.layout.resolve()}
outputs = [args.output.resolve(), args.texture.resolve()]
if args.blend:
    outputs.append(args.blend.resolve())
if len(set(outputs)) != len(outputs) or any(path in inputs for path in outputs):
    raise ValueError('入力と各出力には別々のパスを指定してください')
if args.output.suffix.lower() != '.glb' or args.texture.suffix.lower() != '.png':
    raise ValueError('GLBとPNGを出力するパスを指定してください')
if args.blend and args.blend.suffix.lower() != '.blend':
    raise ValueError('編集用データには.blendのパスを指定してください')
for path in outputs:
    path.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
obj = bpy.data.objects.get('VisitorMesh')
if not obj or obj.type != 'MESH':
    raise ValueError('検証済みNPCメッシュが見つかりません')
mesh = obj.data
old = mesh.uv_layers.get('UVMap')
if old is None or mesh.uv_layers.get('UV_Editable'):
    raise ValueError('元UVがないか、編集用UVが既に存在します')
with np.load(args.layout, allow_pickle=False) as archive:
    uv = archive['uv'].copy()
    material = archive['material'].copy()
if uv.shape != (len(mesh.loops), 2) or material.shape != (len(mesh.polygons),):
    raise ValueError('UV配置とメッシュの面・ループ数が一致しません')
actual_material = np.empty(len(mesh.polygons), dtype=np.int32)
mesh.polygons.foreach_get('material_index', actual_material)
if not np.array_equal(material, actual_material) or not np.isfinite(uv).all():
    raise ValueError('UV配置とメッシュの素材構成が一致しません')

new = mesh.uv_layers.new(name='UV_Editable')
new.data.foreach_set('uv', uv.ravel())
mesh.uv_layers.active = new
new.active_render = True
image = bpy.data.images.new('Visitor_BaseColor_4K', width=4096, height=4096, alpha=True)
image.generated_color = (0, 0, 0, 0)
image.colorspace_settings.name = 'sRGB'
# 旧UVをすべての元画像に明示し、頂点色やMixを含む元の色入力を
# Emissionへ接続する。ライティングは色画像に焼き込まない。
for mat in mesh.materials:
    mat.use_fake_user = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    original_uv = nodes.new('ShaderNodeUVMap')
    original_uv.name = 'Original_UV_for_source'
    original_uv.uv_map = 'UVMap'
    for node in list(nodes):
        if node.type == 'TEX_IMAGE' and not node.inputs['Vector'].is_linked:
            links.new(original_uv.outputs['UV'], node.inputs['Vector'])
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
    emission = nodes.new('ShaderNodeEmission')
    emission.name = 'Original_Color_Bake_Source'
    source_color = bsdf.inputs['Base Color']
    if source_color.is_linked:
        links.new(source_color.links[0].from_socket, emission.inputs['Color'])
    else:
        emission.inputs['Color'].default_value = source_color.default_value
    links.new(emission.outputs[0], output.inputs['Surface'])
    target = nodes.new('ShaderNodeTexImage')
    target.name = 'Editable_4K_Bake_Target'
    target.image = image
    nodes.active = target

bpy.context.view_layer.objects.active = obj
for selected in bpy.context.selected_objects:
    selected.select_set(False)
obj.select_set(True)
bpy.context.scene.render.engine = 'CYCLES'
bpy.context.scene.cycles.samples = 1
bpy.context.scene.render.bake.margin = 5
bpy.ops.object.bake(type='EMIT', uv_layer='UV_Editable', use_clear=True, margin=5)
image.filepath_raw = str(args.texture.resolve())
image.file_format = 'PNG'
image.save()
image.pack()
for mat in mesh.materials:
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
    target = nodes.get('Editable_4K_Bake_Target')
    editable_uv = nodes.new('ShaderNodeUVMap')
    editable_uv.name = 'Editable_UV_for_base_color'
    editable_uv.uv_map = 'UV_Editable'
    links.new(editable_uv.outputs['UV'], target.inputs['Vector'])
    links.new(target.outputs['Color'], bsdf.inputs['Base Color'])
    links.new(bsdf.outputs[0], output.inputs['Surface'])
bpy.context.scene.frame_set(1)
if args.blend:
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend.resolve()))
# 色は4K画像に転写済みのため、頂点色の二重乗算を避ける。
bpy.ops.export_scene.gltf(
    filepath=str(args.output.resolve()), export_format='GLB',
    export_animations=True, export_animation_mode='NLA_TRACKS',
    export_skins=True, export_apply=False, export_image_format='AUTO',
    export_force_sampling=True, export_texcoords=True, export_vertex_color='NONE',
)
print('UV整理版GLBを出力しました:', args.output.resolve())
