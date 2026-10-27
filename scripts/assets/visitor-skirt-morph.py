"""スカートの裾を控えめに揺らす形状キーを追加する。

元のモデルは布と脚が一体のため、高さと胴体中心からの距離を併用し、
鞄・手足を避けながら腰から裾へ変形を滑らかに強くする。
"""

import numpy as np


def add_skirt_morph(mesh):
    if mesh.type != "MESH":
        raise ValueError("スカートの対象はメッシュである必要があります")
    keys = mesh.data.shape_keys
    if keys and keys.key_blocks.get("skirt"):
        raise ValueError("スカートモーフはすでに存在します")
    if not keys:
        mesh.shape_key_add(name="Basis", from_mix=False)
    basis = mesh.data.shape_keys.key_blocks[0]
    shape = mesh.shape_key_add(name="skirt", from_mix=False)
    xyz = np.empty(len(mesh.data.vertices) * 3, dtype=np.float32)
    basis.data.foreach_get("co", xyz)
    xyz = xyz.reshape((-1, 3))

    def smooth(values):
        t = np.clip(values, 0.0, 1.0)
        return t * t * (3.0 - 2.0 * t)

    # 元モデルでは Z が高さ、Y が左右。鞄より下でのみ裾に向けて増加。
    # 内側の脚、裾より下の足とサンダルを避ける。
    height = xyz[:, 2]
    radial = np.sqrt((xyz[:, 0] / 0.09) ** 2 + (xyz[:, 1] / 0.13) ** 2)
    outer = smooth((radial - 0.82) / 0.23)
    lower = smooth((-height - 0.13) / 0.19)
    above_feet = smooth((height + 0.400) / 0.009)
    amount = outer * lower * above_feet
    moved = xyz.copy()
    moved[:, 1] += 0.0045 * amount
    shape.data.foreach_set("co", moved.ravel())
    mesh.data.update()
    return shape
