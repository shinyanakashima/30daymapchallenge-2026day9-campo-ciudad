import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, LngLatBoundsLike, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 の worker は別ファイル。ビルド後のサブパスでも解決できるよう Vite に URL を管理させる
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "./style.css";
import {
  loadAreas,
  loadBuildings,
  loadRoads,
  type RoadCollection,
  bboxOf,
  districtOutline,
  outsideMask,
  type AreaCollection,
  type AreaType,
  type BuildingCollection,
} from "./data";
import { LANGS, TEXT, type Lang, type Strings } from "./i18n";
import { VIEW_POINTS, streetViewUrl } from "./streetview";

maplibregl.setWorkerUrl(workerUrl);

// パラグアイの国旗の赤・白・青に寄せた配色（国旗・国章そのものは使わない）
const C = {
  red: "#d52b1e",
  redDark: "#8e1b12",
  blue: "#0038a8",
  rural: "#fbfaf6",
  ruralLine: "#9aa6c4",
  outside: "#d3d6dd",
  buildingRural: "#0038a8",
  buildingUrban: "#ffffff",
  satUrbanBuilding: "#ff5446",
};
const SATELLITE_TILES = `${new URL(import.meta.env.BASE_URL, location.href).href}tiles/s2-20260926/{z}/{x}/{y}.webp`;
// 背景地図：OpenFreeMap の Positron（OpenStreetMap ベース、APIキー不要）
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
let basemapOk = false;
// パラグアイ全体の範囲（位置確認用）
const PARAGUAY_BOUNDS: LngLatBoundsLike = [[-62.65, -27.61], [-54.26, -19.29]];
// タイルを作った範囲（地区の外接矩形 + 0.03°）
const SATELLITE_BOUNDS: [number, number, number, number] = [-55.359, -25.6235, -54.8615, -25.2185];

// ---- 言語 ----
function initialLang(): Lang {
  const q = new URLSearchParams(location.search).get("lang");
  const known = (v: string | null): v is Lang => LANGS.some((l) => l.code === v);
  if (known(q)) return q;
  try {
    const saved = localStorage.getItem("yguazu-lang");
    if (known(saved)) return saved;
  } catch {
    /* ストレージが使えない環境では既定値 */
  }
  return "en";
}
let lang: Lang = initialLang();
const t = (): Strings => TEXT[lang];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// 数値表記：スペイン語は 8.131 / 47,26 %（4桁でも区切る）、英語・日本語は 8,131 / 47.26%
const fmt = (n: number) => {
  const en = Math.round(n).toLocaleString("en-US");
  return lang === "es" ? en.replace(/,/g, ".") : en;
};
const pctN = (x: number, d: number) => (lang === "es" ? `${x.toFixed(d).replace(".", ",")} %` : `${x.toFixed(d)}%`);
const pctFmt = (x: number) => pctN(x, 2);
const pct1 = (x: number) => pctN(x, 1);

let areas: AreaCollection | null = null;
let buildings: BuildingCollection | null = null;
let buildingError: unknown = null;
let selected: number | null = null;
let popup: maplibregl.Popup | null = null;
let loadError: unknown = null;
// 初期表示は衛星写真＋建物
let view: "census" | "satellite" = "satellite";
let showBuildings = true;
let roads: RoadCollection | null = null;
let showRoads = true;
// 言語切替時に開いているポップアップを描き直すための関数
let popupRefresh: (() => void) | null = null;

function stats() {
  if (!areas) return null;
  const byType = (k: AreaType) => areas!.features.find((f) => f.properties.area_type === k)!.properties.population;
  const urban = byType("urban");
  const rural = byType("rural");
  const total = urban + rural;
  return { urban, rural, total, pu: (urban / total) * 100, pr: (rural / total) * 100 };
}

function buildingStats() {
  if (!buildings) return null;
  let urban = 0;
  for (const f of buildings.features) if (f.properties.area_type === "urban") urban++;
  const total = buildings.features.length;
  const rural = total - urban;
  return { urban, rural, total, pu: (urban / total) * 100, pr: (rural / total) * 100 };
}

function setBar(prefix: string, pu: number, pr: number, label: string, note: string, f: (x: number) => string) {
  const s = t();
  $(`${prefix}-urban`).style.width = `${pu}%`;
  $(`${prefix}-rural`).style.width = `${pr}%`;
  $(`${prefix}-urban`).textContent = f(pu);
  $(`${prefix}-rural`).textContent = f(pr);
  $(prefix).setAttribute("aria-label", `${label}: ${s.urban} ${f(pu)}, ${s.rural} ${f(pr)}. ${note}`);
}

function renderText() {
  const s = t();
  document.documentElement.lang = lang;
  document.title = s.docTitle;
  document.querySelectorAll<HTMLElement>("[data-t]").forEach((el) => {
    el.textContent = s[el.dataset.t as keyof Strings];
  });
  document.querySelectorAll<HTMLButtonElement>("#lang button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
  });
  renderNumbers();
  renderBuildings();
  renderViewList();
  renderStatus();
  renderCredit();
  if (popup?.isOpen()) popupRefresh?.();
}

function renderNumbers() {
  const st = stats();
  if (!st) return;
  const s = t();
  $("pop-urban").textContent = fmt(st.urban);
  $("pop-rural").textContent = fmt(st.rural);
  $("pop-total").textContent = fmt(st.total);
  $("pct-urban").textContent = pctFmt(st.pu);
  $("pct-rural").textContent = pctFmt(st.pr);
  setBar("bar", st.pu, st.pr, s.barLabel, s.barsNote, pctFmt);
}

function renderBuildings() {
  const s = t();
  const status = $("bld-status");
  const b = buildingStats();
  if (b) {
    status.hidden = true;
    $("bld-chart").hidden = false;
    $("bld-urban").textContent = fmt(b.urban);
    $("bld-rural").textContent = fmt(b.rural);
    $("bld-total").textContent = fmt(b.total);
    $("bld-pct-urban").textContent = pct1(b.pu);
    $("bld-pct-rural").textContent = pct1(b.pr);
    setBar("bld-bar", b.pu, b.pr, s.bldBarLabel, s.barsNote, pct1);
  } else {
    $("bld-chart").hidden = true;
    status.hidden = loadError !== null;
    status.className = buildingError ? "bld-status error" : "bld-status";
    status.textContent = buildingError ? s.bldError : s.bldLoading;
  }
}

// ストリートビューの地点一覧（パネル）
function renderViewList() {
  const ol = $("sv-list");
  ol.innerHTML = "";
  for (const p of VIEW_POINTS) {
    const li = document.createElement("li");
    const num = document.createElement("span");
    num.className = "sv-num";
    num.textContent = String(p.n);
    const body = document.createElement("div");
    const a = document.createElement("a");
    a.href = streetViewUrl(p);
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = p.text[lang].title;
    const d = document.createElement("span");
    d.className = "sv-body";
    d.textContent = p.text[lang].body;
    body.append(a, d);
    const go = document.createElement("button");
    go.type = "button";
    go.className = "quiet sv-go";
    go.textContent = t().svShow;
    go.onclick = () => {
      map.flyTo({ center: [p.lng, p.lat], zoom: 15 });
      openViewPopup(p.n);
    };
    li.append(num, body, go);
    ol.append(li);
  }
}

function openViewPopup(n: number) {
  const p = VIEW_POINTS.find((x) => x.n === n);
  if (!p) return;
  const s = t();
  const box = document.createElement("div");
  box.className = "pop pop-sv";
  const h = document.createElement("strong");
  h.textContent = `${p.n}. ${p.text[lang].title}`;
  const b = document.createElement("div");
  b.textContent = p.text[lang].body;
  const a = document.createElement("a");
  a.href = streetViewUrl(p);
  a.target = "_blank";
  a.rel = "noopener";
  a.className = "sv-link";
  a.textContent = s.svOpen;
  box.append(h, b, a);
  popup?.remove();
  setSelected(null);
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: "260px", focusAfterOpen: false, offset: 10 })
    .setLngLat([p.lng, p.lat])
    .setDOMContent(box)
    .addTo(map);
  popupRefresh = () => openViewPopup(n);
}

function renderStatus() {
  const el = $("status");
  const s = t();
  if (loadError) {
    el.className = "status error";
    el.setAttribute("role", "alert");
    el.innerHTML = "";
    const h = document.createElement("strong");
    h.textContent = s.errorTitle;
    const p = document.createElement("p");
    p.textContent = s.errorBody;
    const d = document.createElement("code");
    d.textContent = loadError instanceof Error ? loadError.message : String(loadError);
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s.retry;
    b.onclick = () => location.reload();
    el.append(h, p, d, b);
  } else if (!areas) {
    el.className = "status loading";
    el.textContent = s.loading;
  } else {
    el.className = "status hidden";
    el.textContent = "";
  }
}

// ---- 地図 ----
const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {},
    layers: [{ id: "bg", type: "background", paint: { "background-color": C.outside } }],
  },
  center: [-55.11, -25.42],
  zoom: 9,
  minZoom: 4.5,
  maxZoom: 17,
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
});
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

// クレジットは地図上に常時表示する（表示中の層に合わせて増やす）
let creditEl: HTMLElement | null = null;
class CreditControl implements maplibregl.IControl {
  onAdd() {
    const el = document.createElement("div");
    el.className = "maplibregl-ctrl credit";
    creditEl = el;
    renderCredit();
    return el;
  }
  onRemove() {}
}
function renderCredit() {
  if (!creditEl) return;
  const s = t();
  const parts = [s.attribution];
  if (basemapOk) parts.push(s.attrBasemap);
  // OpenStreetMap の表記は背景地図の表記に含まれるので、建物では重ねて書かない
  if ((showBuildings && buildings) || (showRoads && roads)) parts.push(basemapOk ? s.attrBuildingsShort : s.attrBuildings);
  if (view === "satellite") parts.push(s.attrSatellite);
  creditEl.textContent = parts.join(" · ");
}
map.addControl(new CreditControl(), "bottom-right");

function fitPadding() {
  const small = window.matchMedia("(max-width: 760px)").matches;
  return small ? { top: 100, bottom: 52, left: 16, right: 48 } : { top: 72, bottom: 56, left: 48, right: 72 };
}

let districtBounds: LngLatBoundsLike | null = null;
let urbanBounds: LngLatBoundsLike | null = null;

function showWhole(animate = true) {
  if (districtBounds) map.fitBounds(districtBounds, { padding: fitPadding(), animate });
}

function setSelected(id: number | null) {
  if (selected !== null) map.setFeatureState({ source: "areas", id: selected }, { selected: false });
  selected = id;
  if (id !== null) map.setFeatureState({ source: "areas", id }, { selected: true });
  document.querySelectorAll<HTMLElement>("tr[data-area]").forEach((el) => {
    const f = areas?.features.find((x) => x.properties.area_type === el.dataset.area);
    el.classList.toggle("active", f !== undefined && f.properties.id === id);
  });
}

// ---- 道路：クリックした道路上の点でストリートビューを開く ----
const M_LAT = 110574;
const mLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

// 道路上でクリック位置に最も近い点と、その区間の向き（方位角、度）を求める
function snapToRoad(f: RoadCollection["features"][number], lng: number, lat: number) {
  const kx = mLng(lat);
  const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = { d: Infinity, lng, lat, heading: 0 };
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      const dx = (bx - ax) * kx, dy = (by - ay) * M_LAT;
      const px = (lng - ax) * kx, py = (lat - ay) * M_LAT;
      const len2 = dx * dx + dy * dy;
      const tt = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const qx = dx * tt, qy = dy * tt;
      const d = Math.hypot(px - qx, py - qy);
      if (d < best.d) {
        const heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
        best = { d, lng: ax + qx / kx, lat: ay + qy / M_LAT, heading };
      }
    }
  }
  return best;
}

function pointInRing(x: number, y: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function areaAt(lng: number, lat: number): AreaType | null {
  for (const f of areas?.features ?? []) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      if (pointInRing(lng, lat, poly[0]) && !poly.slice(1).some((h) => pointInRing(lng, lat, h))) return f.properties.area_type;
    }
  }
  return null;
}

const svAt = (lat: number, lng: number, heading: number) =>
  `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}&heading=${Math.round(heading)}`;

function roadLabel(c: string): string {
  const s = t();
  const key = `road_${c}` as keyof Strings;
  return key in s ? s[key] : s.road_other;
}

function openRoadPopup(roadId: number, lng: number, lat: number) {
  const f = roads?.features[roadId];
  if (!f) return;
  const s = t();
  const p = snapToRoad(f, lng, lat);
  const area = areaAt(p.lng, p.lat);
  const box = document.createElement("div");
  box.className = "pop pop-road";
  const h = document.createElement("strong");
  h.textContent = f.properties.name ?? roadLabel(f.properties.class);
  const sub = document.createElement("div");
  sub.className = "pop-sub";
  sub.textContent = [f.properties.name ? roadLabel(f.properties.class) : null, area ? (area === "urban" ? s.legendUrban : s.legendRural) : null]
    .filter(Boolean)
    .join(" · ");
  const a = document.createElement("a");
  a.href = svAt(p.lat, p.lng, p.heading);
  a.target = "_blank";
  a.rel = "noopener";
  a.className = "sv-link";
  a.textContent = s.svHere;
  box.append(h, sub, a);
  popup?.remove();
  if (hoveredRoad !== null) map.setFeatureState({ source: "roads", id: hoveredRoad }, { hover: false });
  map.setFeatureState({ source: "roads", id: roadId }, { hover: true });
  hoveredRoad = roadId;
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: "260px", focusAfterOpen: false, offset: 8 })
    .setLngLat([p.lng, p.lat])
    .setDOMContent(box)
    .addTo(map);
  popup.on("close", () => {
    if (hoveredRoad !== null) map.setFeatureState({ source: "roads", id: hoveredRoad }, { hover: false });
    hoveredRoad = null;
  });
  popupRefresh = () => openRoadPopup(roadId, p.lng, p.lat);
}
let hoveredRoad: number | null = null;

function applyRoads() {
  for (const id of ["roads", "roads-hit"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", showRoads ? "visible" : "none");
  }
  ($("show-roads") as HTMLInputElement).checked = showRoads;
  renderCredit();
}

const isUrban: ExpressionSpecification = ["==", ["get", "area_type"], "urban"];
const isSelected: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];

// 表示モードに合わせて塗り・線・マスクの見た目を切り替える
function applyView() {
  if (!map.getLayer("area-fill")) return;
  const sat = view === "satellite";
  map.setLayoutProperty("satellite", "visibility", sat ? "visible" : "none");
  map.setLayoutProperty("outside-mask", "visibility", "visible");
  // 地区外のマスク：衛星写真は地区の形にくり抜いてあるので、地区外は背景地図を淡くかすませるだけ
  // （背景地図がないときは衛星写真表示でだけ暗くする）
  map.setPaintProperty("outside-mask", "fill-color", basemapOk ? "#c4c8d2" : "#151a26");
  map.setPaintProperty("outside-mask", "fill-opacity", basemapOk ? 0.35 : sat ? 0.62 : 0);
  map.setPaintProperty("area-fill", "fill-color", ["case", isUrban, C.red, C.rural]);
  // 区分の色：背景地図があれば農村を半透明にして、道路や貯水池が透けて見えるようにする
  const ruralOpacity = basemapOk ? 0.62 : 1;
  map.setPaintProperty(
    "area-fill",
    "fill-opacity",
    sat
      ? ["case", isUrban, ["case", isSelected, 0.45, 0.3], ["case", isSelected, 0.18, 0]]
      : ["case", isUrban, 1, ["case", isSelected, Math.min(1, ruralOpacity + 0.2), ruralOpacity]],
  );
  map.setPaintProperty("area-line", "line-color", ["case", isUrban, sat ? C.red : C.redDark, sat ? "#ffffff" : C.ruralLine]);
  map.setPaintProperty("district-outline", "line-color", sat ? "#ffffff" : C.blue);
  map.setPaintProperty(
    "buildings",
    "fill-color",
    // 衛星写真では都市の建物を赤、農村の建物を白にして、都市区域が赤く見えるようにする
    sat ? ["case", isUrban, C.satUrbanBuilding, "#ffffff"] : ["case", isUrban, C.buildingUrban, C.buildingRural],
  );
  map.setPaintProperty("buildings", "fill-opacity", sat ? 0.85 : ["case", isUrban, 0.9, 0.75]);
  map.setPaintProperty(
    "building-points",
    "circle-color",
    // 広域では都市の点を濃い赤にして、赤い都市区域が点で白く埋もれないようにする
    sat ? ["case", isUrban, C.satUrbanBuilding, "#ffffff"] : ["case", isUrban, C.redDark, C.buildingRural],
  );
  map.setPaintProperty("building-points", "circle-opacity", sat ? 0.9 : ["case", isUrban, 0.55, 0.6]);
  if (map.getLayer("roads")) {
    map.setPaintProperty("roads", "line-color", [
      "case",
      ["boolean", ["feature-state", "hover"], false],
      sat ? "#ffffff" : C.blue,
      sat ? "#f3d36b" : "#6f7686",
    ]);
  }
  $("view-census").setAttribute("aria-pressed", String(!sat));
  $("view-satellite").setAttribute("aria-pressed", String(sat));
  document.body.dataset.view = view;
  renderCredit();
}

function applyBuildings() {
  for (const id of ["buildings", "building-points"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", showBuildings ? "visible" : "none");
  }
  ($("show-buildings") as HTMLInputElement).checked = showBuildings;
  renderCredit();
}

// 建物の外周リングの頂点平均を点にする（広域表示用。小さな建物なので十分）
function buildingPoints(b: BuildingCollection): GeoJSON.FeatureCollection<GeoJSON.Point, { area_type: AreaType }> {
  return {
    type: "FeatureCollection",
    features: b.features.map((f) => {
      const ring = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
      let x = 0, y = 0;
      const n = ring.length - 1;
      for (let i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1]; }
      return { type: "Feature", properties: { area_type: f.properties.area_type }, geometry: { type: "Point", coordinates: [x / n, y / n] } };
    }),
  };
}

// 背景地図のスタイルを読み込む。失敗したら背景なしの地図で続ける（国勢調査の地図は表示する）
async function loadBasemap(): Promise<void> {
  const loaded = () => new Promise<void>((res) => (map.loaded() ? res() : map.once("load", () => res())));
  try {
    const res = await fetch(BASEMAP_STYLE, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const style = await res.json();
    await loaded();
    const styled = new Promise<void>((r) => map.once("style.load", () => r()));
    map.setStyle(style);
    await styled;
    // 背景地図の建物は Overture の建物と重複するので隠す
    if (map.getLayer("building")) map.setLayoutProperty("building", "visibility", "none");
    basemapOk = true;
  } catch (e) {
    console.warn("Basemap unavailable; continuing without it", e);
    await loaded();
  }
}

// 自前の層は背景地図のラベルより下に入れ、地名が読めるようにする
let labelsBelow: string | undefined;
function addLayer(layer: maplibregl.AddLayerObject) {
  map.addLayer(layer, labelsBelow);
}

async function start() {
  const mapReady = loadBasemap();
  const roadsPromise = loadRoads().catch((e) => {
    console.error(e);
    return null;
  });
  const buildingsPromise = loadBuildings().catch((e) => {
    console.error(e);
    buildingError = e;
    return null;
  });
  try {
    const [data] = await Promise.all([loadAreas(), mapReady]);
    areas = data;
  } catch (e) {
    console.error(e);
    loadError = e;
    renderStatus();
    renderBuildings();
    return;
  }

  const [w, s, e, n] = bboxOf(areas);
  districtBounds = [[w, s], [e, n]];
  const urban: AreaCollection = { ...areas, features: areas.features.filter((f) => f.properties.area_type === "urban") };
  const [uw, us, ue, un] = bboxOf(urban);
  urbanBounds = [[uw, us], [ue, un]];
  map.setMaxBounds([[-66, -30.5], [-51, -16.5]]);
  labelsBelow = map.getStyle().layers.find((l) => l.type === "symbol")?.id;

  map.addSource("satellite", {
    type: "raster",
    tiles: [SATELLITE_TILES],
    tileSize: 256,
    minzoom: 9,
    maxzoom: 14,
    bounds: SATELLITE_BOUNDS,
  });
  addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } });
  map.addSource("mask", { type: "geojson", data: outsideMask(areas) });
  addLayer({
    id: "outside-mask",
    type: "fill",
    source: "mask",
    layout: { visibility: "none" },
    paint: { "fill-color": "#151a26", "fill-opacity": 0.62 },
  });
  map.addSource("areas", { type: "geojson", data: areas });
  addLayer({ id: "area-fill", type: "fill", source: "areas", paint: { "fill-color": C.rural } });
  map.addSource("buildings", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  // 建物：拡大時は輪郭、広域では小さすぎて見えないため点で分布を示す
  addLayer({ id: "buildings", type: "fill", source: "buildings", minzoom: 12.5, paint: { "fill-color": C.buildingRural } });
  map.addSource("building-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  addLayer({
    id: "building-points",
    type: "circle",
    source: "building-points",
    maxzoom: 12.5,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 1, 12.5, 2.2],
      "circle-color": C.buildingRural,
    },
  });
  // 道路（Overture）。クリックしやすいよう、見えない太い線を判定用に重ねる
  map.addSource("roads", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const major: ExpressionSpecification = ["match", ["get", "class"], ["motorway", "trunk", "primary"], true, false];
  const mid: ExpressionSpecification = ["match", ["get", "class"], ["secondary", "tertiary"], true, false];
  const hov: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];
  addLayer({
    id: "roads",
    type: "line",
    source: "roads",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": "#6f7686",
      "line-opacity": ["case", hov, 1, 0.85],
      "line-width": [
        "interpolate", ["linear"], ["zoom"],
        9, ["case", hov, 3, major, 1.6, mid, 1.1, 0.5],
        14, ["case", hov, 6, major, 4, mid, 3, 1.8],
      ],
    },
  });
  addLayer({
    id: "roads-hit",
    type: "line",
    source: "roads",
    paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 18 },
  });
  addLayer({
    id: "area-line",
    type: "line",
    source: "areas",
    paint: {
      "line-color": C.redDark,
      // 全域表示でも小さな都市区域が見えるよう、低ズームでは都市の線を太めにする
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        9,
        ["case", isSelected, ["case", isUrban, 2.6, 2.6], ["case", isUrban, 1.6, 0.6]],
        13,
        ["case", isSelected, ["case", isUrban, 3.2, 3], ["case", isUrban, 2, 0.6]],
      ],
    },
  });
  // 地区の外周（都市・農村の共有辺を除いた線＝地区界）
  map.addSource("outline", { type: "geojson", data: districtOutline(areas) });
  addLayer({
    id: "district-outline",
    type: "line",
    source: "outline",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": C.blue, "line-width": 2 },
  });
  // 広域表示（パラグアイ全体など）では地区が小さすぎるので、位置を赤い印で示す
  const cx = (w + e) / 2, cy = (s + n) / 2;
  map.addSource("locator", { type: "geojson", data: { type: "Feature", properties: { name: "Yguazú" }, geometry: { type: "Point", coordinates: [cx, cy] } } });
  map.addLayer({
    id: "locator",
    type: "circle",
    source: "locator",
    maxzoom: 8.5,
    paint: { "circle-radius": 7, "circle-color": C.red, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
  });
  if (basemapOk) {
    map.addLayer({
      id: "locator-label",
      type: "symbol",
      source: "locator",
      maxzoom: 8.5,
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 14, "text-offset": [0, 1.3], "text-anchor": "top" },
      paint: { "text-color": C.redDark, "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
    });
  }
  // ストリートビューの地点（番号付きの丸）
  map.addSource("viewpoints", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: VIEW_POINTS.map((p) => ({ type: "Feature", properties: { n: p.n, label: String(p.n) }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } })),
    },
  });
  map.addLayer({
    id: "viewpoints",
    type: "circle",
    source: "viewpoints",
    minzoom: 8.5,
    paint: { "circle-radius": 9, "circle-color": "#ffffff", "circle-stroke-color": C.blue, "circle-stroke-width": 2 },
  });
  if (basemapOk) {
    map.addLayer({
      id: "viewpoints-label",
      type: "symbol",
      source: "viewpoints",
      minzoom: 8.5,
      layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": C.blue },
    });
  }
  map.on("click", "viewpoints", (ev) => {
    const f = ev.features?.[0];
    if (f) openViewPopup(Number(f.properties.n));
  });
  map.on("mouseenter", "viewpoints", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "viewpoints", () => (map.getCanvas().style.cursor = ""));
  map.on("error", (ev) => {
    // 衛星タイル・背景地図タイルの欠落は地図全体のエラーにしない
    const id = (ev as { sourceId?: string }).sourceId;
    if (id !== "satellite" && id !== "openmaptiles" && id !== "ne2_shaded") console.error(ev.error);
  });

  // 道路をクリック：判定用の太い線で拾い、クリック位置に最も近い道路を選ぶ
  map.on("click", (ev) => {
    if (map.queryRenderedFeatures(ev.point, { layers: ["viewpoints"] }).length) return;
    const hits = map.getLayer("roads-hit") && showRoads ? map.queryRenderedFeatures(ev.point, { layers: ["roads-hit"] }) : [];
    if (!hits.length || !roads) {
      popup?.remove();
      return;
    }
    let bestId = -1, bestD = Infinity;
    for (const h of hits as MapGeoJSONFeature[]) {
      const id = Number(h.id);
      const f = roads.features[id];
      if (!f) continue;
      const d = snapToRoad(f, ev.lngLat.lng, ev.lngLat.lat).d;
      if (d < bestD) { bestD = d; bestId = id; }
    }
    if (bestId >= 0) openRoadPopup(bestId, ev.lngLat.lng, ev.lngLat.lat);
  });
  map.on("mouseenter", "roads-hit", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "roads-hit", () => (map.getCanvas().style.cursor = ""));

  for (const id of ["zoom-urban", "reset", "locate", "view-census", "view-satellite"]) ($(id) as HTMLButtonElement).disabled = false;
  $("locate").onclick = () => {
    popup?.remove();
    setSelected(null);
    map.fitBounds(PARAGUAY_BOUNDS, { padding: fitPadding() });
  };
  $("zoom-urban").onclick = () => urbanBounds && map.fitBounds(urbanBounds, { padding: fitPadding(), maxZoom: 15 });
  $("reset").onclick = () => {
    popup?.remove();
    setSelected(null);
    showWhole();
  };
  $("view-census").onclick = () => {
    view = "census";
    applyView();
  };
  $("view-satellite").onclick = () => {
    view = "satellite";
    applyView();
  };
  $("show-roads").onchange = (ev) => {
    showRoads = (ev.target as HTMLInputElement).checked;
    if (!showRoads) popup?.remove();
    applyRoads();
  };
  $("show-buildings").onchange = (ev) => {
    showBuildings = (ev.target as HTMLInputElement).checked;
    applyBuildings();
  };

  applyView();
  showWhole(false);
  renderText();
  window.addEventListener("resize", () => map.resize());

  const r = await roadsPromise;
  if (r) {
    roads = r;
    (map.getSource("roads") as maplibregl.GeoJSONSource).setData(r);
    ($("show-roads") as HTMLInputElement).disabled = false;
  }
  applyRoads();
  applyView();
  const b = await buildingsPromise;
  if (b) {
    buildings = b;
    (map.getSource("buildings") as maplibregl.GeoJSONSource).setData(b);
    (map.getSource("building-points") as maplibregl.GeoJSONSource).setData(buildingPoints(b));
    ($("show-buildings") as HTMLInputElement).disabled = false;
  }
  applyBuildings();
  renderBuildings();
  // 検証用：読み込んだ値を外部から確認できるようにする
  (window as unknown as { __yguazu: unknown }).__yguazu = { stats: stats(), buildings: buildingStats(), roads: roads?.features.length ?? 0, bbox: [w, s, e, n] };
  document.body.dataset.ready = "true";
}

// 言語切替（EN / ES / 日本語）
for (const l of LANGS) {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.lang = l.code;
  b.lang = l.code;
  b.textContent = l.label;
  b.onclick = () => {
    lang = l.code;
    try {
      localStorage.setItem("yguazu-lang", lang);
    } catch {
      /* 無視 */
    }
    renderText();
  };
  $("lang").append(b);
}

renderText();
start();
