"""提供された閉眼画像から、額への前髪の誤投影を防ぐ参照画像を作る。"""
import argparse
import hashlib
from pathlib import Path

from PIL import Image, ImageFilter


parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path, help="所有者提供の閉眼画像")
parser.add_argument("output", type=Path, help="参照画像の出力先")
args = parser.parse_args()
expected = "4004da2a1d7a2555358fceb1e182ad4f672cc7de1e3cc76f732d7c2a193b94de"
if hashlib.sha256(args.source.read_bytes()).hexdigest() != expected:
    raise ValueError("閉眼画像が検証済みの原本と一致しません")
if args.source.resolve() == args.output.resolve():
    raise ValueError("原本を上書きすることはできません")

image = Image.open(args.source).convert("RGB")
width, _ = image.size
skin = image.crop((0, 560, width, 590)).resize((width, 1))
skin = skin.filter(ImageFilter.GaussianBlur(15)).resize((width, 570))
image.paste(skin, (0, 0))
image.save(args.output)
