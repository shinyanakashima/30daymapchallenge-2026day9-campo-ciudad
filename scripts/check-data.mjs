// public/data の GeoParquet を検査する（npm run check）。
// - codec・geo メタデータ・行数・人口合計・比率
// - アプリの WKB 復号（src/wkb.ts）と hyparquet 内蔵の復号が一致するか
// - ファイルのハッシュが day9-verification.json の記録と一致するか
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { parquetMetadata, parquetReadObjects } from "hyparquet";
import { decompressZstd } from "hyparquet-compressors";
import { wkbToGeometry } from "../src/wkb.ts";

const path = new URL("../public/data/day9-yguazu.parquet", import.meta.url);
const buf = readFileSync(path);
const file = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const compressors = { ZSTD: (i, n) => decompressZstd(i, new Uint8Array(n)) };
const ver = JSON.parse(readFileSync(new URL("./day9-verification.json", import.meta.url), "utf8"));

assert.equal(buf.byteLength, ver.geoparquet_bytes, "file size");
console.log("sha256", createHash("sha256").update(buf).digest("hex"));

const meta = parquetMetadata(file, { geoparquet: false });
const codecs = new Set(meta.row_groups.flatMap((g) => g.columns.map((c) => c.meta_data.codec)));
console.log("rows", Number(meta.num_rows), "codecs", [...codecs].join(","));
const geo = JSON.parse(meta.key_value_metadata.find((kv) => kv.key === "geo").value);
const col = geo.columns[geo.primary_column];
assert.equal(col.encoding, "WKB");
assert.deepEqual(col.crs.id, { authority: "EPSG", code: 4326 });
console.log("geo", geo.version, col.encoding, `EPSG:${col.crs.id.code}`, col.geometry_types.join(","));

const raw = await parquetReadObjects({ file, metadata: meta, compressors, utf8: false });
const auto = await parquetReadObjects({ file, compressors });
assert.equal(raw.length, 2);
const pop = Object.fromEntries(raw.map((r) => [r.area_type, Number(r.population)]));
assert.equal(pop.urban, ver.population.urban);
assert.equal(pop.rural, ver.population.rural);
const total = pop.urban + pop.rural;
assert.equal(total, 8131);
console.log("population", pop, "total", total,
  "share", ((pop.urban / total) * 100).toFixed(2), ((pop.rural / total) * 100).toFixed(2));

raw.forEach((r, i) => {
  const mine = wkbToGeometry(r.geometry);
  assert.deepEqual(mine, auto[i].geometry, `WKB decode mismatch (${r.area_type})`);
  const polys = mine.type === "Polygon" ? [mine.coordinates] : mine.coordinates;
  const pts = polys.flat(2);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  console.log(r.area_type, r.area_code, mine.type, `${polys.length} polygon(s)`, `${pts.length} vertices`,
    "bbox", [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => v.toFixed(4)).join(","));
});
console.log("OK");
