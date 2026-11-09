# Overture の道路を Yguazú 地区で切り抜き、GeoParquet にする（歩道・小道は除く）
# 使い方: python scripts/prepare-roads.py roads_all.json public/data/day9-yguazu.parquet public/data/day9-yguazu-roads.parquet
import collections
import json
import sys

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import shapely
from shapely import wkb
from shapely.geometry import shape

src, areas_path, out = sys.argv[1:4]
EXCLUDE = {"footway", "path", "steps", "cycleway", "pedestrian", "bridleway"}
district = shapely.union_all([wkb.loads(a["geometry"]) for a in pq.read_table(areas_path).to_pylist()])
shapely.prepare(district)

cls, names, geoms = [], [], []
for r in json.load(open(src)):
    if r["class"] in EXCLUDE:
        continue
    g = shape(r["geometry"]).intersection(district)
    if g.is_empty:
        continue
    g = shapely.set_precision(g, 1e-6)  # 約0.1 m
    parts = [x for x in getattr(g, "geoms", [g]) if x.geom_type == "LineString" and not x.is_empty]
    if not parts:
        continue
    g = parts[0] if len(parts) == 1 else shapely.MultiLineString(parts)
    cls.append(r["class"] or "unknown")
    names.append(r["name"])
    geoms.append(g)

geoms = np.array(geoms)
gt = sorted(set(x.geom_type for x in geoms))
geo = {"version": "1.1.0", "primary_column": "geometry", "columns": {"geometry": {
    "encoding": "WKB", "geometry_types": gt, "crs": {"id": {"authority": "EPSG", "code": 4326}},
    "bbox": [float(v) for v in shapely.total_bounds(geoms)]}}}
tbl = pa.table({"class": pa.array(cls), "name": pa.array(names, pa.string()),
                "geometry": pa.array(shapely.to_wkb(geoms), pa.binary())})
tbl = tbl.replace_schema_metadata({"geo": json.dumps(geo)})
pq.write_table(tbl, out, compression="zstd", compression_level=19)
print("segments", len(geoms), collections.Counter(cls), gt)
