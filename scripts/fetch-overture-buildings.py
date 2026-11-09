# Overture Maps の建物（release 2026-10-21.0）を Yguazú 地区の外接矩形で取り出す
# 使い方: python scripts/fetch-overture-buildings.py buildings_raw.parquet
# 必要: duckdb（httpfs 拡張）。S3 は匿名アクセス。
# HTTPS_PROXY が設定されていればプロキシ経由、CA_BUNDLE（または AWS_CA_BUNDLE）があれば証明書に使う。
import os
import sys
import time
import urllib.parse

import duckdb

RELEASE = "2026-10-21.0"
XMIN, YMIN, XMAX, YMAX = -55.3290, -25.5935, -54.8915, -25.2485

out = sys.argv[1]
t = time.time()
con = duckdb.connect()
con.sql("INSTALL httpfs; LOAD httpfs;")
proxy = os.environ.get("HTTPS_PROXY")
if proxy:
    p = urllib.parse.urlparse(proxy)
    con.sql(f"SET http_proxy='{p.hostname}:{p.port}'")
    if p.username:
        con.sql(f"SET http_proxy_username='{urllib.parse.unquote(p.username)}'")
        con.sql(f"SET http_proxy_password='{urllib.parse.unquote(p.password or '')}'")
ca = os.environ.get("CA_BUNDLE") or os.environ.get("AWS_CA_BUNDLE")
if ca:
    con.sql(f"SET ca_cert_file='{ca}'")
con.sql("CREATE SECRET anon (TYPE S3, KEY_ID '', SECRET '', REGION 'us-west-2')")
con.sql(f"""
COPY (
  SELECT id, geometry, sources, subtype, class, height, num_floors
  FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=buildings/type=building/*', hive_partitioning=1)
  WHERE bbox.xmin <= {XMAX} AND bbox.xmax >= {XMIN} AND bbox.ymin <= {YMAX} AND bbox.ymax >= {YMIN}
) TO '{out}' (FORMAT PARQUET, COMPRESSION ZSTD)
""")
print("rows", con.sql(f"SELECT count(*) FROM '{out}'").fetchall()[0][0], "sec", round(time.time() - t))
