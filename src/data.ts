// GeoParquet を取得し、検証してから GeoJSON FeatureCollection に変換する。
import { parquetMetadata, parquetReadObjects } from "hyparquet";
import { decompressZstd } from "hyparquet-compressors";
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon, Position } from "geojson";
import { wkbToGeometry } from "./wkb";

export type AreaType = "urban" | "rural";
export type AreaProps = {
  id: number;
  area_type: AreaType;
  area_code: string;
  district_code: string;
  census_year: number;
  population: number;
};
export type AreaCollection = FeatureCollection<Polygon | MultiPolygon, AreaProps>;

// 実ファイルの codec は ZSTD のみ。必要な展開器だけを渡す
const compressors = { ZSTD: (input: Uint8Array, outputLength: number) => decompressZstd(input, new Uint8Array(outputLength)) };

export const DATA_URL = `${import.meta.env.BASE_URL}data/day9-yguazu.parquet`;
export const BUILDINGS_URL = `${import.meta.env.BASE_URL}data/day9-yguazu-buildings.parquet`;
export const ROADS_URL = `${import.meta.env.BASE_URL}data/day9-yguazu-roads.parquet`;

// GeoParquet の CRS が WGS84 経緯度（x=経度, y=緯度）であることを確認する。
// crs 省略時は仕様上 OGC:CRS84。
function checkGeoMetadata(geoJson: string | undefined): void {
  if (!geoJson) throw new Error("GeoParquet 'geo' metadata is missing");
  const geo = JSON.parse(geoJson);
  const col = geo.columns?.[geo.primary_column];
  if (!col) throw new Error("GeoParquet primary geometry column is missing");
  if (col.encoding !== "WKB") throw new Error(`Unsupported geometry encoding: ${col.encoding}`);
  const id = col.crs?.id;
  const ok =
    col.crs === undefined ||
    (id?.authority === "EPSG" && id?.code === 4326) ||
    (id?.authority === "OGC" && id?.code === "CRS84");
  if (!ok) throw new Error("Geometry CRS is not WGS84 longitude/latitude");
}

// GeoParquet を取得して行を返す。geometry は WKB のバイト列のまま。
// geoparquet:false・utf8:false で hyparquet の自動変換を止め、自前で復号する
// （UTF8 注釈付きの文字列列は utf8:false でも文字列のまま返る）
async function readGeoParquet(url: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} while loading ${url}`);
  const file = await res.arrayBuffer();
  const metadata = parquetMetadata(file, { geoparquet: false });
  checkGeoMetadata(metadata.key_value_metadata?.find((kv) => kv.key === "geo")?.value);
  return parquetReadObjects({ file, metadata, compressors, utf8: false });
}

export async function loadAreas(url = DATA_URL): Promise<AreaCollection> {
  const rows = await readGeoParquet(url);

  const features: Feature<Polygon | MultiPolygon, AreaProps>[] = rows.map((row, i) => {
    const type = row.area_type;
    if (type !== "urban" && type !== "rural") throw new Error(`Unexpected area_type: ${String(type)}`);
    const population = Number(row.population);
    if (!Number.isInteger(population) || population <= 0) throw new Error(`Invalid population for ${type}`);
    if (!(row.geometry instanceof Uint8Array)) throw new Error("Geometry column is not WKB bytes");
    const geometry = wkbToGeometry(row.geometry);
    checkBounds(geometry);
    return {
      type: "Feature",
      id: i,
      geometry,
      properties: {
        id: i,
        area_type: type,
        area_code: String(row.area_code),
        district_code: String(row.district_code),
        census_year: Number(row.census_year),
        population,
      },
    };
  });

  const types = features.map((f) => f.properties.area_type).sort().join(",");
  if (types !== "rural,urban") throw new Error(`Expected one urban and one rural row, got: ${types}`);
  return { type: "FeatureCollection", features };
}

export type BuildingProps = { area_type: AreaType; source: "osm" | "google" | "microsoft" };
export type BuildingCollection = FeatureCollection<Polygon | MultiPolygon, BuildingProps>;

export async function loadBuildings(url = BUILDINGS_URL): Promise<BuildingCollection> {
  const rows = await readGeoParquet(url);
  if (rows.length === 0) throw new Error("No buildings in file");
  const features = rows.map((row): Feature<Polygon | MultiPolygon, BuildingProps> => {
    const type = row.area_type;
    const source = row.source;
    if (type !== "urban" && type !== "rural") throw new Error(`Unexpected area_type: ${String(type)}`);
    if (source !== "osm" && source !== "google" && source !== "microsoft") throw new Error(`Unexpected source: ${String(source)}`);
    if (!(row.geometry instanceof Uint8Array)) throw new Error("Geometry column is not WKB bytes");
    const geometry = wkbToGeometry(row.geometry);
    checkBounds(geometry);
    return { type: "Feature", geometry, properties: { area_type: type, source } };
  });
  return { type: "FeatureCollection", features };
}

// sv: ストリートビューの画像がある可能性が高い道路（国道・県道と都市区域内の道路）。アプリ側で設定する
export type RoadProps = { id: number; class: string; name: string | null; sv?: boolean };
export type RoadCollection = FeatureCollection<LineString | MultiLineString, RoadProps>;

export async function loadRoads(url = ROADS_URL): Promise<RoadCollection> {
  const rows = await readGeoParquet(url);
  if (rows.length === 0) throw new Error("No roads in file");
  const features = rows.map((row, i): Feature<LineString | MultiLineString, RoadProps> => {
    if (!(row.geometry instanceof Uint8Array)) throw new Error("Geometry column is not WKB bytes");
    const geometry = wkbToGeometry(row.geometry, true);
    const pts = geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates.flat();
    for (const [x, y] of pts) {
      if (!(x >= -62 && x <= -54 && y >= -28 && y <= -19)) throw new Error("Road coordinates fall outside Paraguay");
    }
    return {
      type: "Feature",
      id: i,
      geometry,
      properties: { id: i, class: String(row.class), name: row.name == null ? null : String(row.name) },
    };
  });
  return { type: "FeatureCollection", features };
}

// 座標が経緯度の範囲（かつ南半球・西半球）にあるか。緯度経度の入れ替わりを検出する。
function checkBounds(g: Polygon | MultiPolygon): void {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const p of polys) for (const ring of p) for (const [x, y] of ring) {
    if (!(x >= -62 && x <= -54 && y >= -28 && y <= -19)) {
      throw new Error("Coordinates fall outside Paraguay; axis order may be wrong");
    }
  }
}

export function bboxOf(fc: AreaCollection): [number, number, number, number] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of fc.features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const p of polys) for (const [x, y] of p[0]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

// 地区の外周線：都市・農村の両方に現れる辺（共有境界）を除き、片方にしかない辺だけを
// 連続する線としてつなぐ（2点ずつの線分に分けると継ぎ目に隙間が出るため）
export function districtOutline(fc: AreaCollection): FeatureCollection<MultiLineString> {
  const key = (a: Position, b: Position) => {
    const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
    return `${p[0]},${p[1]}|${q[0]},${q[1]}`;
  };
  const rings: Position[][] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    for (const p of g.type === "Polygon" ? [g.coordinates] : g.coordinates) rings.push(...p);
  }
  const count = new Map<string, number>();
  for (const ring of rings) for (let i = 0; i < ring.length - 1; i++) {
    const k = key(ring[i], ring[i + 1]);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const lines: Position[][] = [];
  for (const ring of rings) {
    let cur: Position[] | null = null;
    for (let i = 0; i < ring.length - 1; i++) {
      if (count.get(key(ring[i], ring[i + 1])) === 1) {
        if (!cur) cur = [ring[i]];
        cur.push(ring[i + 1]);
      } else if (cur) {
        lines.push(cur);
        cur = null;
      }
    }
    if (cur) lines.push(cur);
  }
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } }] };
}

// 地区外を覆うマスク：外側の大きな矩形に、地区の外周リングを穴として開ける
export function outsideMask(fc: AreaCollection): FeatureCollection<Polygon> {
  const outline = districtOutline(fc).features[0].geometry.coordinates;
  // 外周線は閉じたリングとして得られる（都市は地区内部の穴なので共有辺で消える）
  const rings = outline.filter((l) => l.length > 3 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1]);
  if (rings.length === 0) return { type: "FeatureCollection", features: [] };
  const world: Position[] = [[-80, -60], [-30, -60], [-30, 10], [-80, 10], [-80, -60]];
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...rings] } }] };
}
