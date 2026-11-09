# Overture の道路（subtype=road の全クラス）を Yguazú 地区の外接矩形で取り出す
# 使い方: python scripts/fetch-overture-roads.py roads.json
import os, sys, urllib.parse, duckdb, json
con = duckdb.connect()
con.sql("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
if os.environ.get("HTTPS_PROXY"):
    p = urllib.parse.urlparse(os.environ["HTTPS_PROXY"])
    con.sql(f"SET http_proxy='{p.hostname}:{p.port}'")
    if p.username:
        con.sql(f"SET http_proxy_username='{urllib.parse.unquote(p.username)}'")
        con.sql(f"SET http_proxy_password='{urllib.parse.unquote(p.password or '')}'")
ca = os.environ.get("CA_BUNDLE") or os.environ.get("AWS_CA_BUNDLE")
if ca:
    con.sql(f"SET ca_cert_file='{ca}'")
con.sql("CREATE SECRET anon (TYPE S3, KEY_ID '', SECRET '', REGION 'us-west-2')")
rows = con.sql("""
SELECT id, class, names.primary AS name, ST_AsGeoJSON(geometry) AS g
FROM read_parquet('s3://overturemaps-us-west-2/release/2026-10-21.0/theme=transportation/type=segment/*', hive_partitioning=1)
WHERE subtype='road'
  AND bbox.xmin <= -54.8915 AND bbox.xmax >= -55.329 AND bbox.ymin <= -25.2485 AND bbox.ymax >= -25.5935
""").fetchall()
json.dump([{"id": i, "class": c, "name": n, "geometry": json.loads(g)} for i, c, n, g in rows], open(sys.argv[1], "w"))
print(len(rows))
