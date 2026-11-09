# Sentinel-2 L2A の TCI（真色、10 m）を Web メルカトルに再投影してモザイクする
# 使い方: python scripts/s2-mosaic.py <作業ディレクトリ> scripts/s2-items-20260926.txt
# 出力: mosaic.npy（z14 のピクセル格子）と grid.json。タイル化は s2-tiles.py
import math, os, sys, json
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_origin

OUT = sys.argv[1]
# 引数2：「アイテムID TCIのURL」を1行ずつ並べたファイル
ITEMS = [l.split() for l in open(sys.argv[2]) if l.strip()]

W, Sx, E, N = -55.3290 - 0.03, -25.5935 - 0.03, -54.8915 + 0.03, -25.2485 + 0.03
R = 6378137.0
def merc(lon, lat):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
# z14 のピクセル寸法に合わせたグリッド
Z = 14
res = 2 * math.pi * R / (256 * 2 ** Z)
x0, y1 = merc(W, N); x1, y0 = merc(E, Sx)
org = -math.pi * R
px0 = math.floor((x0 - org) / res); px1 = math.ceil((x1 - org) / res)
py0 = math.floor((-y1 - org) / res); py1 = math.ceil((-y0 - org) / res)   # 上から数えたピクセル
w, h = px1 - px0, py1 - py0
transform = from_origin(org + px0 * res, -(org + py0 * res), res, res)
print("grid", w, h, file=sys.stderr)

env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
           GDAL_HTTP_MULTIRANGE="YES", GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES")
if os.environ.get("HTTPS_PROXY"):
    env["GDAL_HTTP_PROXY"] = os.environ["HTTPS_PROXY"]
if os.environ.get("CA_BUNDLE") or os.environ.get("AWS_CA_BUNDLE"):
    env["CURL_CA_BUNDLE"] = os.environ.get("CA_BUNDLE") or os.environ["AWS_CA_BUNDLE"]
mosaic = np.zeros((3, h, w), np.uint8)
filled = np.zeros((h, w), bool)
with rasterio.Env(**env):
    for it, url in ITEMS:
        with rasterio.open(url) as src:
            dst = np.zeros((3, h, w), np.uint8)
            reproject(rasterio.band(src, [1, 2, 3]), dst, src_nodata=0, dst_nodata=0,
                      dst_transform=transform, dst_crs="EPSG:3857", resampling=Resampling.bilinear)
            valid = (dst.sum(0) > 0) & ~filled
            mosaic[:, valid] = dst[:, valid]
            filled |= valid
            print(it, "added", int(valid.sum()), file=sys.stderr)
print("coverage", filled.mean(), file=sys.stderr)
np.save(os.path.join(OUT, "mosaic.npy"), mosaic)
json.dump({"px0": px0, "py0": py0, "w": w, "h": h, "z": Z}, open(os.path.join(OUT, "grid.json"), "w"))
