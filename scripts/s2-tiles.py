# モザイク（z14 のピクセル格子）から z9〜14 の XYZ JPEG タイルを作る
# 使い方: python scripts/s2-tiles.py <作業ディレクトリ> public/tiles/s2-20260926
import json, os, sys, numpy as np
from PIL import Image
work, out = sys.argv[1:3]
g = json.load(open(os.path.join(work, "grid.json")))
m = np.load(os.path.join(work, "mosaic.npy")).transpose(1, 2, 0)
# 軽い明るさ補正（ガンマ 0.85）
lut = (255 * (np.arange(256) / 255) ** 0.85).astype(np.uint8)
m = lut[m]
ZMAX, ZMIN = g["z"], 9
k = 2 ** (ZMAX - ZMIN)
px0, py0 = g["px0"], g["py0"]
# 最小ズームまで2分の1を繰り返せるよう、左上を k の倍数に、右下も k の倍数に揃える
pl, pt = px0 % k, py0 % k
W = -(-(m.shape[1] + pl) // k) * k; H = -(-(m.shape[0] + pt) // k) * k
img = np.zeros((H, W, 3), np.uint8); img[pt:pt + m.shape[0], pl:pl + m.shape[1]] = m
ox, oy = px0 - pl, py0 - pt
level = Image.fromarray(img)
n = 0; size = 0
for z in range(ZMAX, ZMIN - 1, -1):
    s = 2 ** (ZMAX - z)
    lx, ly = ox // s, oy // s
    arr = np.asarray(level)
    for ty in range(ly // 256, (ly + arr.shape[0] - 1) // 256 + 1):
        for tx in range(lx // 256, (lx + arr.shape[1] - 1) // 256 + 1):
            tile = np.zeros((256, 256, 3), np.uint8)
            x0, y0 = tx * 256 - lx, ty * 256 - ly
            sx0, sy0 = max(x0, 0), max(y0, 0)
            sx1, sy1 = min(x0 + 256, arr.shape[1]), min(y0 + 256, arr.shape[0])
            part = arr[sy0:sy1, sx0:sx1]
            if not part.any(): continue
            tile[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = part
            p = os.path.join(out, str(z), str(tx)); os.makedirs(p, exist_ok=True)
            f = os.path.join(p, f"{ty}.jpg")
            Image.fromarray(tile).save(f, quality=80, optimize=True, progressive=True)
            n += 1; size += os.path.getsize(f)
    if z > ZMIN:
        level = level.resize((level.width // 2, level.height // 2), Image.LANCZOS)
print("tiles", n, "MB", round(size / 1e6, 1))
