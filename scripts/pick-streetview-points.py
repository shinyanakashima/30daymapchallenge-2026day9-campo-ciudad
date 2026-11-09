# ストリートビューのリンク地点を、国道PY02上の建物密度から選ぶ
# 使い方: python scripts/pick-streetview-points.py roads.json public/data/day9-yguazu.parquet public/data/day9-yguazu-buildings.parquet
import json, sys, numpy as np, pyarrow.parquet as pq, shapely
from shapely import wkb
from shapely.geometry import shape
from pyproj import Transformer
R = json.load(open(sys.argv[1]))
areas = {a["area_type"]: wkb.loads(a["geometry"]) for a in pq.read_table(sys.argv[2]).to_pylist()}
district = shapely.union_all(list(areas.values()))
bt = pq.read_table(sys.argv[3]); bg = shapely.from_wkb(bt.column("geometry").to_numpy(zero_copy_only=False))
bc = shapely.centroid(bg)
tf = Transformer.from_crs(4326, 32721, always_xy=True).transform
inv = Transformer.from_crs(32721, 4326, always_xy=True).transform
py02 = shapely.line_merge(shapely.union_all([shape(r["geometry"]) for r in R if r["name"] == "Ruta Nacional Mariscal Estigarribia"]))
py02m = shapely.transform(py02, lambda c: np.column_stack(tf(c[:,0], c[:,1])))
bcm = shapely.transform(bc, lambda c: np.column_stack(tf(c[:,0], c[:,1])))
tree = shapely.STRtree(bcm)
urb_m = shapely.transform(areas["urban"], lambda c: np.column_stack(tf(c[:,0], c[:,1])))
dist_m = shapely.transform(district, lambda c: np.column_stack(tf(c[:,0], c[:,1])))
pts = []
for line in (py02m.geoms if hasattr(py02m, "geoms") else [py02m]):
    for d in np.arange(0, line.length, 150):
        p = line.interpolate(d)
        if not dist_m.contains(p): continue
        n = len(tree.query(p.buffer(300)))
        pts.append((p, n, urb_m.contains(p), urb_m.distance(p)))
lon = lambda p: inv(p.x, p.y)
print("samples", len(pts))
urban = [x for x in pts if x[2]]; rural = [x for x in pts if not x[2]]
best_u = max(urban, key=lambda x: x[1])
east_edge = max([x for x in rural if 300 < x[3] < 1200], key=lambda x: x[1])
west = max([x for x in rural if lon(x[0])[0] < -55.12], key=lambda x: x[1])
mid = min([x for x in rural if -55.10 < lon(x[0])[0] < -55.04 and x[3] > 2500], key=lambda x: x[1])
for name, x in [("urban", best_u), ("east_edge", east_edge), ("west_cluster", west), ("fields", mid)]:
    lo, la = lon(x[0]); print(name, round(la, 6), round(lo, 6), "bldgs300m", x[1], "dist_urban_m", round(x[3]))
