# Overture の建物を Yguazú 地区で切り出し、代表点が入る区分（都市・農村）を付けて GeoParquet にする
# 使い方: python scripts/prepare-buildings.py buildings_raw.parquet public/data/day9-yguazu.parquet public/data/day9-yguazu-buildings.parquet
import sys, json, collections
import numpy as np, pyarrow as pa, pyarrow.parquet as pq
import shapely
from shapely import wkb
from shapely.prepared import prep

raw, areas_path, out = sys.argv[1:4]
areas = pq.read_table(areas_path).to_pylist()
polys = {a["area_type"]: prep(wkb.loads(a["geometry"])) for a in areas}
src_name = {"OpenStreetMap": "osm", "Google Open Buildings": "google", "Microsoft ML Buildings": "microsoft"}

t = pq.read_table(raw)
geoms = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
pts = shapely.point_on_surface(geoms)
types, keep, srcs = [], [], []
for i, (g, p, s) in enumerate(zip(geoms, pts, t.column("sources").to_pylist())):
    k = "urban" if polys["urban"].contains(p) else "rural" if polys["rural"].contains(p) else None
    if k is None: continue
    keep.append(i); types.append(k); srcs.append(src_name[s[0]["dataset"]])
g = shapely.set_precision(geoms[keep], 1e-6)          # 約0.1 m に丸める
g = np.array([x if x.geom_type in ("Polygon", "MultiPolygon") else None for x in g])
ok = np.array([x is not None and not x.is_empty for x in g])
g, types, srcs = g[ok], np.array(types)[ok], np.array(srcs)[ok]
c = shapely.centroid(g); order = np.lexsort((shapely.get_x(c), np.round(shapely.get_y(c), 2), types))
g, types, srcs = g[order], types[order], srcs[order]
gt = sorted(set(x.geom_type for x in g))
b = shapely.total_bounds(g)
geo = {"version": "1.1.0", "primary_column": "geometry", "columns": {"geometry": {
    "encoding": "WKB", "geometry_types": gt, "crs": {"id": {"authority": "EPSG", "code": 4326}},
    "bbox": [float(v) for v in b]}}}
tbl = pa.table({"area_type": pa.array(types), "source": pa.array(srcs),
                "geometry": pa.array(shapely.to_wkb(g), pa.binary())})
tbl = tbl.replace_schema_metadata({"geo": json.dumps(geo)})
pq.write_table(tbl, out, compression="zstd", compression_level=19)
print("kept", len(g), "of", t.num_rows, collections.Counter(types), collections.Counter(zip(types, srcs)), gt)
