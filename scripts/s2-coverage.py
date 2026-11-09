# モザイクが Yguazú 地区を欠けなく覆うか確認する
# 使い方: (作業ディレクトリで) python s2-coverage.py public/data/day9-yguazu.parquet
import json, math, sys, numpy as np, pyarrow.parquet as pq, shapely
from shapely import wkb
from rasterio.features import rasterize
from rasterio.transform import from_origin
g = json.load(open("grid.json")); m = np.load("mosaic.npy", mmap_mode="r")
R = 6378137.0; res = 2*math.pi*R/(256*2**g["z"]); org = -math.pi*R
tr = from_origin(org + g["px0"]*res, -(org + g["py0"]*res), res, res)
d = shapely.union_all([wkb.loads(a["geometry"]) for a in pq.read_table(sys.argv[1]).to_pylist()])
dm = shapely.transform(d, lambda c: np.column_stack([R*np.radians(c[:, 0]), R*np.log(np.tan(np.pi/4+np.radians(c[:, 1])/2))]))
mask = rasterize([dm], out_shape=(g["h"], g["w"]), transform=tr).astype(bool)
filled = m.sum(0) > 0
print("district px", mask.sum(), "uncovered", (mask & ~filled).sum(), "frac", (mask & ~filled).sum()/mask.sum())
