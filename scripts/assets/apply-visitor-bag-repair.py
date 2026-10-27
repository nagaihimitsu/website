#!/usr/bin/env python3
"""鞄修復の差分を、指定された未圧縮GLBへ適用する（Python 3 + numpy）。

    python scripts/assets/apply-visitor-bag-repair.py input.glb repaired.glb

通常のサイトビルドでは実行しない。入力は docs/ROOM_VISITOR.md に記載の
軽量化・画像縮小後、Meshopt圧縮前のGLB。元ファイルは上書きしない。
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import zipfile

import numpy as np


COMPONENT_TYPES = {5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1"}
DIMENSIONS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
VECTOR_TYPES = {2: "VEC2", 3: "VEC3", 4: "VEC4"}


def read_glb(data: bytes) -> tuple[dict, bytes, dict[str, np.ndarray], np.ndarray]:
    """Read the fixed, uncompressed, single-primitive repair source."""
    if len(data) < 28:
        raise ValueError("Input is too short to be a GLB file")
    magic, version, length = struct.unpack_from("<III", data)
    if magic != 0x46546C67 or version != 2 or length != len(data):
        raise ValueError("Input must be a complete GLB version 2 file")

    chunks = {}
    offset = 12
    while offset < len(data):
        size, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        if offset + size > len(data):
            raise ValueError("Truncated GLB chunk")
        chunks[kind] = data[offset : offset + size]
        offset += size
    document = json.loads(chunks[0x4E4F534A])
    binary = chunks[0x004E4942]
    if len(document["meshes"]) != 1 or len(document["meshes"][0]["primitives"]) != 1:
        raise ValueError("Repair source must have one mesh and one primitive")
    primitive = document["meshes"][0]["primitives"][0]
    if primitive.get("mode", 4) != 4:
        raise ValueError("Repair source must contain indexed triangles")

    def accessor(index: int) -> np.ndarray:
        item = document["accessors"][index]
        if "sparse" in item:
            raise ValueError("Sparse source accessors are not supported")
        view = document["bufferViews"][item["bufferView"]]
        dtype = np.dtype(COMPONENT_TYPES[item["componentType"]])
        width = DIMENSIONS[item["type"]]
        start = view.get("byteOffset", 0) + item.get("byteOffset", 0)
        stride = view.get("byteStride", dtype.itemsize * width)
        return np.ndarray(
            (item["count"], width),
            dtype=dtype,
            buffer=binary,
            offset=start,
            strides=(stride, dtype.itemsize),
        ).copy()

    attributes = {key: accessor(index) for key, index in primitive["attributes"].items()}
    faces = accessor(primitive["indices"]).reshape(-1, 3)
    return document, binary, attributes, faces


def encode_glb(document: dict, images: list[bytes], primitives: list[tuple]) -> bytes:
    """Repack geometry while copying every embedded source image unchanged."""
    document = copy.deepcopy(document)
    document["bufferViews"] = []
    document["accessors"] = []
    binary = bytearray()

    def buffer_view(data: bytes) -> int:
        binary.extend(b"\0" * (-len(binary) % 4))
        document["bufferViews"].append(
            {"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)}
        )
        binary.extend(data)
        return len(document["bufferViews"]) - 1

    def accessor(values: np.ndarray, kind: str, component: int) -> int:
        item = {
            "bufferView": buffer_view(values.tobytes()),
            "componentType": component,
            "count": len(values),
            "type": kind,
        }
        if kind == "VEC3":
            item["min"] = values.min(axis=0).astype(float).tolist()
            item["max"] = values.max(axis=0).astype(float).tolist()
        document["accessors"].append(item)
        return len(document["accessors"]) - 1

    encoded = []
    for index, (attributes, faces, material) in enumerate(primitives):
        if index == 0:
            used, inverse = np.unique(faces, return_inverse=True)
            attributes = {key: values[used] for key, values in attributes.items()}
            faces = inverse.reshape(-1, 3)
            primitive = copy.deepcopy(document["meshes"][0]["primitives"][0])
        else:
            primitive = {"material": material}
        primitive["attributes"] = {
            key: accessor(values.astype("<f4"), VECTOR_TYPES[values.shape[1]], 5126)
            for key, values in attributes.items()
        }
        primitive["indices"] = accessor(faces.reshape(-1).astype("<u4"), "SCALAR", 5125)
        encoded.append(primitive)
    document["meshes"][0]["primitives"] = encoded

    for image, data in zip(document["images"], images, strict=True):
        image["bufferView"] = buffer_view(data)
    binary.extend(b"\0" * (-len(binary) % 4))
    document["buffers"] = [{"byteLength": len(binary)}]
    metadata = json.dumps(document, separators=(",", ":")).encode()
    metadata += b" " * (-len(metadata) % 4)
    return (
        struct.pack("<III", 0x46546C67, 2, 28 + len(metadata) + len(binary))
        + struct.pack("<II", len(metadata), 0x4E4F534A)
        + metadata
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )


def apply_repair(source: bytes, archive_path: Path) -> tuple[bytes, int]:
    with zipfile.ZipFile(archive_path) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        if manifest["format"] != 1:
            raise ValueError("Unsupported repair archive format")
        if hashlib.sha256(source).hexdigest() != manifest["source_sha256"]:
            raise ValueError("Source SHA-256 does not match this repair archive")

        document, binary, attributes, faces = read_glb(source)
        if len(attributes["POSITION"]) != manifest["source_vertices"] or len(faces) != manifest["source_faces"]:
            raise ValueError("Source geometry counts do not match the repair archive")
        images = []
        for image in document["images"]:
            view = document["bufferViews"][image["bufferView"]]
            start = view.get("byteOffset", 0)
            images.append(binary[start : start + view["byteLength"]])

        with np.load(io.BytesIO(archive.read("geometry.npz")), allow_pickle=False) as geometry:
            for key in manifest["base_attributes"]:
                changed_key = f"changed_{key}_indices"
                if changed_key in geometry:
                    attributes[key][geometry[changed_key]] = geometry[f"changed_{key}_values"]
                attributes[key] = np.concatenate([attributes[key], geometry[f"added_{key}"]])
            keep = np.ones(len(faces), dtype=bool)
            keep[geometry["removed_faces"]] = False
            faces = np.concatenate([faces[keep], geometry["added_faces"]])
            primitives = [(attributes, faces, document["meshes"][0]["primitives"][0].get("material", 0))]
            for index, extra in enumerate(manifest["extras"]):
                extra_attributes = {
                    key: geometry[f"extra_{index}_{key}"] for key in extra["attributes"]
                }
                primitives.append((extra_attributes, geometry[f"extra_{index}_faces"], extra["material"]))

            document["materials"] = manifest["materials"]
            document["textures"] = manifest["textures"]
            for image in manifest["images"]:
                images.append(archive.read(image["file"]))
                document["images"].append({"name": image["name"], "mimeType": image["mimeType"]})
            result = encode_glb(document, images, primitives)
            return result, sum(len(primitive[1]) for primitive in primitives)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path, help="未圧縮の visitor-orm.glb")
    parser.add_argument("output", type=Path, help="修復済みGLBの保存先")
    parser.add_argument(
        "--repair", type=Path, default=Path(__file__).with_name("visitor-bag-repair.zip"),
        help="修復差分ZIP（既定はこのスクリプトと同じフォルダ）",
    )
    args = parser.parse_args()
    if args.output.resolve() in {args.source.resolve(), args.repair.resolve()}:
        parser.error("Output must be different from the source and repair archive")
    try:
        result, triangles = apply_repair(args.source.read_bytes(), args.repair)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=args.output.parent, suffix=".glb", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(result)
            os.replace(temporary, args.output)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    except (OSError, ValueError, KeyError, IndexError, struct.error, zipfile.BadZipFile) as error:
        parser.exit(1, f"Repair failed: {error}\n")
    print(f"Saved {args.output}: {len(result):,} bytes, {triangles:,} triangles")


if __name__ == "__main__":
    main()
