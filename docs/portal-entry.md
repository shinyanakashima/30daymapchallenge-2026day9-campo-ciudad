# ポータル掲載用情報（Day 9）

`public/data/2026/works.json` の Day 9 `projects` に追加する内容。

| 項目 | 値 |
| --- | --- |
| id | `yguazu-urban-rural` |
| 作品名 | Yguazúの都市と農村 |
| Title | Urban and Rural in Yguazú |
| 公開URL | https://shinyanakashima.github.io/30daymapchallenge-2026day9-campo-ciudad/ |
| リポジトリ | https://github.com/shinyanakashima/30daymapchallenge-2026day9-campo-ciudad |
| サムネイル | `docs/screenshot.png`（1200×900） |
| タグ | MapLibre, GeoParquet, INE Paraguay, Overture Maps, Sentinel-2 |
| タグ（日本語） | MapLibre, GeoParquet, パラグアイ国立統計局, Overture Maps, Sentinel-2 |

## 説明

- 日本語：パラグアイYguazú地区を2022年国勢調査の都市・農村で塗り分ける。人口8,131人は都市と農村でほぼ半々。建物、道路、衛星写真を重ね、道路からストリートビューも開ける。
- English: Urban and rural census areas of Yguazú, Paraguay, in 2022. Its 8,131 residents are split almost evenly between the two. Overlay buildings, roads and a satellite image, and open Street View from the roads.

## サムネイル代替テキスト

- 日本語：Yguazúの都市と農村の画面
- English: Screenshot of Urban and Rural in Yguazú

## works.json 用の断片

```json
{
  "id": "yguazu-urban-rural",
  "title": "Yguazúの都市と農村",
  "description": "パラグアイYguazú地区を2022年国勢調査の都市・農村で塗り分ける。人口8,131人は都市と農村でほぼ半々。建物、道路、衛星写真を重ね、道路からストリートビューも開ける。",
  "status": "published",
  "thumbnail": "images/2026/works/yguazu-urban-rural.jpg",
  "thumbnailAlt": "Yguazúの都市と農村の画面",
  "appUrl": "https://shinyanakashima.github.io/30daymapchallenge-2026day9-campo-ciudad/",
  "repoUrl": "https://github.com/shinyanakashima/30daymapchallenge-2026day9-campo-ciudad",
  "articleUrl": null,
  "videoUrl": null,
  "tags": ["MapLibre", "GeoParquet", "パラグアイ国立統計局", "Overture Maps", "Sentinel-2"],
  "publishedAt": null,
  "updatedAt": "2026-11-09",
  "verifiedAt": "2026-11-09",
  "en": {
    "title": "Urban and Rural in Yguazú",
    "description": "Urban and rural census areas of Yguazú, Paraguay, in 2022. Its 8,131 residents are split almost evenly between the two. Overlay buildings, roads and a satellite image, and open Street View from the roads.",
    "tags": ["MapLibre", "GeoParquet", "INE Paraguay", "Overture Maps", "Sentinel-2"],
    "thumbnailAlt": "Screenshot of Urban and Rural in Yguazú"
  }
}
```

クレジット：

- Instituto Nacional de Estadística (INE), Paraguay – Censo Nacional de Población y Viviendas 2022（Cartografía digital 2022、Estructura de la población por edad y sexo）。パラグアイ公共情報利用ライセンス。
- 建物：Overture Maps Foundation（release 2026-10-21.0、ODbL）。© OpenStreetMap contributors、Google Open Buildings（CC BY 4.0）、Microsoft ML Building Footprints（ODbL）。
- 衛星写真：Contains modified Copernicus Sentinel data 2026（Sentinel-2 L2A、2026-09-26）。
