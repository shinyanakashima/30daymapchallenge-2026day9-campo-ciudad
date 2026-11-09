# モザイク（z14 のピクセル格子）を Yguazú 地区の形でくり抜き、z9〜14 の XYZ タイル（透過 WebP）を作る
# 使い方: python scripts/s2-tiles.py <作業ディレクトリ> public/data/day9-yguazu.parquet public/tiles/s2-20260926
# 地区の外は透明にして、背景地図が見えるようにする
import json
import math
import os
import sys

import numpy as np
import pyarrow.parquet as pq
import shapely
from PIL import Image
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely import wkb

work, district_path, out = sys.argv[1:4]
g = json.load(open(os.path.join(work, "grid.json")))
m = np.load(os.path.join(work, "mosaic.npy")).transpose(1, 2, 0)
# 軽い明るさ補正（ガンマ 0.85）
lut = (255 * (np.arange(256) / 255) ** 0.85).astype(np.uint8)
m = lut[m]

ZMAX, ZMIN = g["z"], 9
R = 6378137.0
res = 2 * math.pi * R / (256 * 2 ** ZMAX)
org = -math.pi * R

# 地区（都市・農村の合併）を z14 のピクセル格子でラスタ化してアルファにする
district = shapely.union_all([wkb.loads(a["geometry"]) for a in pq.read_table(district_path).to_pylist()])
district_m = shapely.transform(
    district,
    lambda c: np.column_stack([R * np.radians(c[:, 0]), R * np.log(np.tan(np.pi / 4 + np.radians(c[:, 1]) / 2))]),
)
tr = from_origin(org + g["px0"] * res, -(org + g["py0"] * res), res, res)
alpha = rasterize([district_m], out_shape=(g["h"], g["w"]), transform=tr, all_touched=True).astype(np.uint8) * 255
alpha[m.sum(2) == 0] = 0

k = 2 ** (ZMAX - ZMIN)
px0, py0 = g["px0"], g["py0"]
# 最小ズームまで2分の1を繰り返せるよう、左上と右下を k の倍数に揃える
pl, pt = px0 % k, py0 % k
W = -(-(m.shape[1] + pl) // k) * k
H = -(-(m.shape[0] + pt) // k) * k
img = np.zeros((H, W, 4), np.uint8)
img[pt:pt + m.shape[0], pl:pl + m.shape[1], :3] = m
img[pt:pt + m.shape[0], pl:pl + m.shape[1], 3] = alpha
ox, oy = px0 - pl, py0 - pt
# 縮小時に透明部分の黒がにじまないよう、乗算済みアルファ（RGBa）で扱う
level = Image.fromarray(img, "RGBA").convert("RGBa")
n = 0
size = 0
for z in range(ZMAX, ZMIN - 1, -1):
    s = 2 ** (ZMAX - z)
    lx, ly = ox // s, oy // s
    arr = np.asarray(level.convert("RGBA"))
    for ty in range(ly // 256, (ly + arr.shape[0] - 1) // 256 + 1):
        for tx in range(lx // 256, (lx + arr.shape[1] - 1) // 256 + 1):
            tile = np.zeros((256, 256, 4), np.uint8)
            x0, y0 = tx * 256 - lx, ty * 256 - ly
            sx0, sy0 = max(x0, 0), max(y0, 0)
            sx1, sy1 = min(x0 + 256, arr.shape[1]), min(y0 + 256, arr.shape[0])
            part = arr[sy0:sy1, sx0:sx1]
            p = os.path.join(out, str(z), str(tx))
            os.makedirs(p, exist_ok=True)
            f = os.path.join(p, f"{ty}.webp")
            if not part[..., 3].any():
                # 範囲内の完全に透明なタイルは極小の透明画像にする（404 を出さないため）
                Image.new("RGBA", (256, 256), (0, 0, 0, 0)).save(f, "WEBP", lossless=True)
            else:
                tile[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = part
                Image.fromarray(tile, "RGBA").save(f, "WEBP", quality=80, method=6)
            n += 1
            size += os.path.getsize(f)
    if z > ZMIN:
        level = level.resize((level.width // 2, level.height // 2), Image.LANCZOS)
print("tiles", n, "MB", round(size / 1e6, 1))
