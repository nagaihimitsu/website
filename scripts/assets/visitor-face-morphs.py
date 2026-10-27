"""一体メッシュのNPCに、顔を壊さない控えめな口の形状キーを追加する。"""
import numpy as np


def add_face_morphs(mesh):
    if mesh.type != 'MESH':
        raise ValueError('NPCのメッシュが必要です')
    if mesh.data.shape_keys and 'mouth' in mesh.data.shape_keys.key_blocks:
        raise ValueError('mouth形状キーは既に存在します')
    if not mesh.data.shape_keys:
        mesh.shape_key_add(name='Basis', from_mix=False)
    coords = np.empty(len(mesh.data.vertices) * 3, dtype=np.float64)
    mesh.data.vertices.foreach_get('co', coords)
    coords = coords.reshape(-1, 3)

    def smoothstep(a, b, x):
        t = np.clip((x - a) / (b - a), 0, 1)
        return t * t * (3 - 2 * t)

    # 原本の唇は顔と一体なので、大きく閉じると顔に折れ目が生じる。
    # 前面・口周辺だけを最大約20%縮め、周辺へ滑らかに移行させる。
    depth = smoothstep(.045, .060, coords[:, 0]) * (1 - smoothstep(.090, .105, coords[:, 0]))
    center = .261
    height_weight = 1 - smoothstep(.012, .024, np.abs(coords[:, 2] - center))
    side_weight = 1 - smoothstep(.016, .028, np.abs(coords[:, 1]))
    amount = depth * height_weight * side_weight * .194
    out = coords.copy()
    out[:, 2] -= (coords[:, 2] - center) * amount
    key = mesh.shape_key_add(name='mouth', from_mix=False)
    key.data.foreach_set('co', out.astype(np.float32).ravel())
