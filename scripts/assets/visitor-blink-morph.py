"""目元の凹凸を閉眼時に周囲の顔曲面へなじませる形状キー。"""

import numpy as np


def add_blink_morph(mesh):
    if mesh.type != 'MESH':
        raise ValueError('NPCのメッシュが必要です')
    if mesh.data.shape_keys and 'blink' in mesh.data.shape_keys.key_blocks:
        raise ValueError('blink形状キーは既に存在します')
    if not mesh.data.shape_keys:
        mesh.shape_key_add(name='Basis', from_mix=False)
    coords = np.empty(len(mesh.data.vertices) * 3, dtype=np.float32)
    mesh.data.shape_keys.key_blocks[0].data.foreach_get('co', coords)
    coords = coords.reshape((-1, 3))
    x, y, z = coords[:, 0], coords[:, 1], coords[:, 2]
    out = coords.copy()

    def terms(y_value, z_value):
        return np.array([y_value * 0 + 1, y_value, z_value,
                         y_value * y_value, y_value * z_value, z_value * z_value]).T

    # 目の外側の肌を使い、左右別に二次曲面を推定する。
    # 頭髪や顔の奥を含まないように正面の限定領域のみを選択する。
    for side in (-1, 1):
        dy, dz = (y - side * .046) / .032, (z - .317) / .031
        radius = np.sqrt(dy * dy + dz * dz)
        border = ((radius > 1.12) & (radius < 1.75) & (x > .045) & (x < .10)
                  & (z > .274) & (z < .36))
        if np.count_nonzero(border) < 30:
            raise ValueError('目の周囲の肌が不足しています')
        matrix, surface = terms(dy[border], dz[border]), x[border]
        for _ in range(5):
            coeff = np.linalg.lstsq(matrix, surface, rcond=None)[0]
            error = surface - matrix @ coeff
            keep = np.abs(error) < max(.0025, np.quantile(np.abs(error), .70))
            matrix, surface = matrix[keep], surface[keep]
            if len(surface) < 6:
                raise ValueError('目元の曲面を安定して推定できません')
        target = terms(dy, dz) @ coeff
        t = np.clip((radius - .70) / .50, 0, 1)
        weight = 1 - t * t * (3 - 2 * t)
        weight *= np.clip((x - .045) / .015, 0, 1) * np.clip((.105 - x) / .015, 0, 1)
        out[:, 0] += ((target - x) * weight).astype(np.float32)

    key = mesh.shape_key_add(name='blink', from_mix=False)
    key.data.foreach_set('co', out.ravel())
    mesh.data.update()
    return key
