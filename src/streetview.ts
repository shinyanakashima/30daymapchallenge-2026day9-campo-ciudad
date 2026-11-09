// Google ストリートビューへのリンクを置く地点（国道 PY02 上）。
// 地点は Overture の道路（Ruta Nacional Mariscal Estigarribia）上で、建物の密度から選んだ。
// リンクは Google Maps URLs（APIキー不要）で、指定地点に最も近いパノラマを開く。
import type { Lang } from "./i18n";

export type ViewPoint = {
  n: number;
  lat: number;
  lng: number;
  text: Record<Lang, { title: string; body: string }>;
};

export const VIEW_POINTS: ViewPoint[] = [
  {
    n: 1,
    lat: -25.464841,
    lng: -55.0047,
    text: {
      en: { title: "Town centre", body: "Highway PY02 inside the urban census area." },
      es: { title: "Centro urbano", body: "Ruta PY02 dentro del área urbana censal." },
      ja: { title: "町の中心", body: "都市区域の中を通る国道PY02。" },
    },
  },
  {
    n: 2,
    lat: -25.454529,
    lng: -55.038429,
    text: {
      en: {
        title: "Just outside the urban line",
        body: "About 1 km west of the urban area. Buildings continue along the road, but the census counts this as rural.",
      },
      es: {
        title: "Justo fuera del límite urbano",
        body: "A 1 km al oeste del área urbana. Las edificaciones siguen junto a la ruta, pero el censo lo cuenta como rural.",
      },
      ja: {
        title: "都市区域のすぐ外",
        body: "都市区域の西約1km。道沿いに建物は続くが、国勢調査では農村に区分される。",
      },
    },
  },
  {
    n: 3,
    lat: -25.445976,
    lng: -55.165321,
    text: {
      en: { title: "Roadside settlement", body: "A cluster of buildings on PY02 about 16 km west of the town, in the rural area." },
      es: { title: "Asentamiento sobre la ruta", body: "Un grupo de edificaciones sobre la PY02, a unos 16 km al oeste del centro, en el área rural." },
      ja: { title: "国道沿いの集落", body: "町から西へ約16km、農村区域の国道PY02沿いにある建物の集まり。" },
    },
  },
  {
    n: 4,
    lat: -25.44983,
    lng: -55.08666,
    text: {
      en: { title: "Farmland", body: "Fields along PY02 in the rural area, with few buildings." },
      es: { title: "Campos de cultivo", body: "Campos junto a la PY02 en el área rural, con pocas edificaciones." },
      ja: { title: "畑", body: "農村区域の国道PY02沿いの畑。建物は少ない。" },
    },
  },
];

export const streetViewUrl = (p: ViewPoint) =>
  `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}`;
