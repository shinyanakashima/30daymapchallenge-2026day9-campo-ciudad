// WKB（ISO / OGC 2D）を GeoJSON Geometry に復号する。
// このデータに含まれる Polygon / MultiPolygon だけを扱い、それ以外は例外にする。
import type { MultiPolygon, Polygon, Position } from "geojson";

type Reader = { view: DataView; offset: number };

function readHeader(r: Reader): { little: boolean; type: number } {
  const order = r.view.getUint8(r.offset);
  if (order !== 0 && order !== 1) throw new Error(`Invalid WKB byte order: ${order}`);
  const little = order === 1;
  const type = r.view.getUint32(r.offset + 1, little);
  r.offset += 5;
  return { little, type };
}

function readRings(r: Reader, little: boolean): Position[][] {
  const nRings = r.view.getUint32(r.offset, little);
  r.offset += 4;
  const rings: Position[][] = [];
  for (let i = 0; i < nRings; i++) {
    const nPoints = r.view.getUint32(r.offset, little);
    r.offset += 4;
    const ring: Position[] = new Array(nPoints);
    for (let j = 0; j < nPoints; j++) {
      const x = r.view.getFloat64(r.offset, little);
      const y = r.view.getFloat64(r.offset + 8, little);
      r.offset += 16;
      ring[j] = [x, y];
    }
    rings.push(ring);
  }
  return rings;
}

export function wkbToGeometry(bytes: Uint8Array): Polygon | MultiPolygon {
  const r: Reader = { view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 };
  const { little, type } = readHeader(r);
  let geom: Polygon | MultiPolygon;
  if (type === 3) {
    geom = { type: "Polygon", coordinates: readRings(r, little) };
  } else if (type === 6) {
    const n = r.view.getUint32(r.offset, little);
    r.offset += 4;
    const polys: Position[][][] = [];
    for (let i = 0; i < n; i++) {
      const h = readHeader(r);
      if (h.type !== 3) throw new Error(`Unexpected WKB type inside MultiPolygon: ${h.type}`);
      polys.push(readRings(r, h.little));
    }
    geom = { type: "MultiPolygon", coordinates: polys };
  } else {
    throw new Error(`Unsupported WKB geometry type: ${type}`);
  }
  if (r.offset !== bytes.byteLength) throw new Error("Trailing bytes after WKB geometry");
  return geom;
}
