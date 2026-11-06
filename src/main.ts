import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, LngLatBoundsLike, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 の worker は別ファイル。ビルド後のサブパスでも解決できるよう Vite に URL を管理させる
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "./style.css";
import { loadAreas, bboxOf, districtOutline, type AreaCollection, type AreaType } from "./data";
import { TEXT, type Lang, type Strings } from "./i18n";

maplibregl.setWorkerUrl(workerUrl);

const COLORS = {
  urban: "#d4551c",
  urbanLine: "#8f3108",
  rural: "#e6e3c8",
  ruralLine: "#a9a37a",
  outside: "#d9d9d6",
  boundary: "#3b3a36",
};

// ---- 言語 ----
function initialLang(): Lang {
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "ja" || q === "en") return q;
  try {
    const saved = localStorage.getItem("yguazu-lang");
    if (saved === "ja" || saved === "en") return saved;
  } catch {
    /* ストレージが使えない環境では既定値 */
  }
  return "en";
}
let lang: Lang = initialLang();
const t = (): Strings => TEXT[lang];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString("en-US");
const pctFmt = (x: number) => `${x.toFixed(2)}%`;

let areas: AreaCollection | null = null;
let selected: number | null = null;
let popup: maplibregl.Popup | null = null;
let loadError: unknown = null;

function stats() {
  if (!areas) return null;
  const byType = (k: AreaType) => areas!.features.find((f) => f.properties.area_type === k)!.properties.population;
  const urban = byType("urban");
  const rural = byType("rural");
  const total = urban + rural;
  return { urban, rural, total, pu: (urban / total) * 100, pr: (rural / total) * 100 };
}

function renderText() {
  const s = t();
  document.documentElement.lang = lang;
  document.title = s.docTitle;
  document.querySelectorAll<HTMLElement>("[data-t]").forEach((el) => {
    el.textContent = s[el.dataset.t as keyof Strings];
  });
  $("lang").textContent = s.langButton;
  $("lang").setAttribute("lang", lang === "en" ? "ja" : "en");
  renderNumbers();
  renderStatus();
  attributionEl && (attributionEl.textContent = s.attribution);
  if (popup && selected !== null) openPopupFor(selected, popup.getLngLat());
}

function renderNumbers() {
  const st = stats();
  if (!st) return;
  $("pop-urban").textContent = fmt(st.urban);
  $("pop-rural").textContent = fmt(st.rural);
  $("pop-total").textContent = fmt(st.total);
  $("pct-urban").textContent = pctFmt(st.pu);
  $("pct-rural").textContent = pctFmt(st.pr);
  $("bar-urban").style.width = `${st.pu}%`;
  $("bar-rural").style.width = `${st.pr}%`;
  $("bar-urban").textContent = pctFmt(st.pu);
  $("bar-rural").textContent = pctFmt(st.pr);
  const s = t();
  $("bar").setAttribute(
    "aria-label",
    `${s.barLabel}: ${s.urban} ${pctFmt(st.pu)}, ${s.rural} ${pctFmt(st.pr)}. ${s.barNote}`,
  );
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
    layers: [{ id: "bg", type: "background", paint: { "background-color": COLORS.outside } }],
  },
  center: [-55.11, -25.42],
  zoom: 9,
  minZoom: 7,
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

// クレジットは地図上に常時表示する
let attributionEl: HTMLElement | null = null;
class CreditControl implements maplibregl.IControl {
  onAdd() {
    const el = document.createElement("div");
    el.className = "maplibregl-ctrl credit";
    attributionEl = el;
    el.textContent = t().attribution;
    return el;
  }
  onRemove() {}
}
map.addControl(new CreditControl(), "bottom-right");

function fitPadding() {
  const small = window.matchMedia("(max-width: 760px)").matches;
  return small ? { top: 24, bottom: 36, left: 20, right: 52 } : { top: 48, bottom: 56, left: 48, right: 72 };
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
  document.querySelectorAll<HTMLElement>(".num[data-area]").forEach((el) => {
    const f = areas?.features.find((x) => x.properties.area_type === el.dataset.area);
    el.classList.toggle("active", f !== undefined && f.properties.id === id);
  });
}

function openPopupFor(id: number, lngLat: maplibregl.LngLatLike) {
  const f = areas?.features.find((x) => x.properties.id === id);
  const st = stats();
  if (!f || !st) return;
  const s = t();
  const p = f.properties;
  const share = p.area_type === "urban" ? st.pu : st.pr;
  const box = document.createElement("div");
  box.className = `pop pop-${p.area_type}`;
  const h = document.createElement("strong");
  h.textContent = p.area_type === "urban" ? s.urban : s.rural;
  const n = document.createElement("div");
  n.className = "pop-num";
  n.textContent = `${fmt(p.population)} ${s.people}`;
  const r = document.createElement("div");
  r.textContent = `${pctFmt(share)} ${s.popupShare}`;
  const y = document.createElement("div");
  y.className = "pop-year";
  y.textContent = `INE, ${p.census_year}`;
  box.append(h, n, r, y);
  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: "240px", focusAfterOpen: false })
    .setLngLat(lngLat)
    .setDOMContent(box)
    .addTo(map);
  popup.on("close", () => {
    if (popup && !popup.isOpen()) setSelected(null);
  });
}

async function start() {
  try {
    const [data] = await Promise.all([
      loadAreas(),
      new Promise<void>((res) => (map.loaded() ? res() : map.once("load", () => res()))),
    ]);
    areas = data;
  } catch (e) {
    console.error(e);
    loadError = e;
    renderStatus();
    return;
  }

  const [w, s, e, n] = bboxOf(areas);
  districtBounds = [[w, s], [e, n]];
  const urban: AreaCollection = { ...areas, features: areas.features.filter((f) => f.properties.area_type === "urban") };
  const [uw, us, ue, un] = bboxOf(urban);
  urbanBounds = [[uw, us], [ue, un]];
  map.setMaxBounds([[w - 0.6, s - 0.45], [e + 0.6, n + 0.45]]);

  map.addSource("areas", { type: "geojson", data: areas });
  const isUrban: ExpressionSpecification = ["==", ["get", "area_type"], "urban"];
  map.addLayer({
    id: "area-fill",
    type: "fill",
    source: "areas",
    paint: {
      "fill-color": ["case", isUrban, COLORS.urban, COLORS.rural],
    },
  });
  map.addLayer({
    id: "area-line",
    type: "line",
    source: "areas",
    paint: {
      "line-color": ["case", isUrban, COLORS.urbanLine, COLORS.ruralLine],
      // 全域表示でも小さな都市区域が見えるよう、低ズームでは都市の線を太めにする
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        9,
        ["case", ["boolean", ["feature-state", "selected"], false], ["case", isUrban, 2.4, 2.6], ["case", isUrban, 1.4, 0.6]],
        13,
        ["case", ["boolean", ["feature-state", "selected"], false], ["case", isUrban, 3, 3], ["case", isUrban, 1, 0.6]],
      ],
    },
  });
  // 地区の外周（都市・農村の共有辺を除いた線＝地区界）
  map.addSource("outline", { type: "geojson", data: districtOutline(areas) });
  map.addLayer({
    id: "district-outline",
    type: "line",
    source: "outline",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": COLORS.boundary, "line-width": 1.8 },
  });

  map.on("click", "area-fill", (ev) => {
    const f = ev.features?.[0] as MapGeoJSONFeature | undefined;
    if (!f) return;
    const id = Number(f.properties.id);
    setSelected(id);
    openPopupFor(id, ev.lngLat);
  });
  map.on("click", (ev) => {
    const hit = map.queryRenderedFeatures(ev.point, { layers: ["area-fill"] });
    if (!hit.length) {
      popup?.remove();
      setSelected(null);
    }
  });
  map.on("mouseenter", "area-fill", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "area-fill", () => (map.getCanvas().style.cursor = ""));

  ($("zoom-urban") as HTMLButtonElement).disabled = false;
  ($("reset") as HTMLButtonElement).disabled = false;
  $("zoom-urban").onclick = () => urbanBounds && map.fitBounds(urbanBounds, { padding: fitPadding(), maxZoom: 15 });
  $("reset").onclick = () => {
    popup?.remove();
    setSelected(null);
    showWhole();
  };

  showWhole(false);
  renderText();
  window.addEventListener("resize", () => map.resize());
  // 検証用：読み込んだ値を外部から確認できるようにする
  (window as unknown as { __yguazu: unknown }).__yguazu = { stats: stats(), bbox: [w, s, e, n] };
  document.body.dataset.ready = "true";
}

$("lang").onclick = () => {
  lang = lang === "en" ? "ja" : "en";
  try {
    localStorage.setItem("yguazu-lang", lang);
  } catch {
    /* 無視 */
  }
  renderText();
};

renderText();
start();
