"""修復済みNPCの胴体に、控えめな呼吸用のシェイプキーを追加する。

Blender 4.3.2 の Python で、リグ生成直後の元メッシュに対して呼ぶ。
頭・首を動かさず、衣服と肩ひもを含む胴体の同じ変形を緩やかにつなぐ。
"""

import numpy as np


def add_breath_morph(mesh):
    if mesh.type != "MESH":
        raise ValueError("呼吸モーフの対象はメッシュである必要があります")
    keys = mesh.data.shape_keys
    if keys and keys.key_blocks.get("breath"):
        raise ValueError("呼吸モーフはすでに存在します")
    if not keys:
        mesh.shape_key_add(name="Basis", from_mix=False)
    basis = mesh.data.shape_keys.key_blocks[0]
    shape = mesh.shape_key_add(name="breath", from_mix=False)
    n = len(mesh.data.vertices)
    xyz = np.empty(n * 3, dtype=np.float32)
    basis.data.foreach_get("co", xyz)
    xyz = xyz.reshape((n, 3))

    def smooth(values):
        t = np.clip(values, 0.0, 1.0)
        return t * t * (3.0 - 2.0 * t)

    # 提供モデルの +X が正面、Z が高さ。胸元から腹部へ窓を滑らかに落とし、
    # 首・頭やスカートの裾は動かさない。腕・鞄側にも変位を自然に減衰させる。
    h = xyz[:, 2]
    lateral = np.abs(xyz[:, 1])
    height_window = smooth((h + 0.025) / 0.085) * (1.0 - smooth((h - 0.14) / 0.075))
    side_window = 1.0 - smooth((lateral - 0.075) / 0.09)
    amount = height_window * side_window
    moved = xyz.copy()
    moved[:, 0] += (xyz[:, 0] + 0.03) * (0.018 * amount)
    moved[:, 1] += xyz[:, 1] * (0.012 * amount)
    moved[:, 2] += 0.0007 * amount
    shape.data.foreach_set("co", moved.ravel())
    mesh.data.update()
    return shape
