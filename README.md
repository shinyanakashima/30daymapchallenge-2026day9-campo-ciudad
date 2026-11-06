# Urban and Rural in Yguazú / Yguazúの都市と農村

30DayMapChallenge 2026 Day 9「Urban-rural」の作品。パラグアイ Alto Paraná 県 Yguazú 地区（地区コード1009）を、2022年国勢調査の都市・農村区分で2色に塗り分け、それぞれの人口を示す。地区人口8,131人のうち47.26%（3,843人）が、地図上では小さな都市区域に暮らしている。

- 公開URL：https://shinyanakashima.github.io/30daymapchallenge-2026day9-campo-ciudad/
- 日本語表示：画面右上の「日本語」ボタン、または `?lang=ja`

![画面](docs/screenshot.png)

*Urban and rural census areas of Yguazú, Alto Paraná, Paraguay, with their 2022 populations. Almost half of the district's 8,131 residents live in the small urban area. English is the default; Japanese is available from the header button.*

## 表示しているもの

| 区分 | INE area code | 人口（2022年） | 人口割合 |
| --- | --- | ---: | ---: |
| Urban / 都市 | 1 | 3,843 | 47.26% |
| Rural / 農村 | 6 | 4,288 | 52.74% |
| Total / 合計 | — | 8,131 | 100% |

人口割合は画面の横棒で示し、「面積の割合ではない」と明記している。境界から計算できる参考面積（都市約7.59 km²、農村約787.41 km²）は公表統計値ではないため、画面には出していない。

## 出典

- Instituto Nacional de Estadística（INE）, Paraguay. [Cartografía digital 2022](https://www.ine.gov.py/microdatos/cartografia-digital-2022.php)：Alto Paraná の GeoJSON（RAR、11,885,739 bytes、SHA-256 `a9ff06b8…5527158`）。`Barrios Localidades_Alto Parana.geojson` と `Distritos_Alto Parana.geojson` を使用。
- INE. [Censo 2022 – Estructura de la población por edad y sexo](https://www.ine.gov.py/Publicaciones/Biblioteca/documento/257/Censo%202022%20-%20Estructura%20de%20la%20poblacion%20por%20edad%20y%20sexo.pdf)：Cuadro A1・A13 の Yguazú 都市・農村人口。PDFの値を確認して入力した（自動取得したCSVではない）。
- AREAコードの意味（`1=URBANA`、`6=RURAL`）は、INEのRARに説明表が同梱されていないため、パラグアイ保健省ドメインの[公式コード表](https://vigicanpy.mspbs.gov.py/guia/site/CodeSystem-GeoTipoAreasPYCS.html)で補った。
- 取得・加工：2026年11月。

### ライセンス

元データは[パラグアイ公共情報利用ライセンス](https://www.ine.gov.py/microdatos/license.php)に従って利用し、出典・加工内容・取得時点を README と画面に記している。本作品はINEの公式成果物・後援作品ではない。

リポジトリの `LICENSE`（MIT）はアプリのコードにのみ適用する。`public/data/day9-yguazu.parquet` とその元データには適用しない。

## 加工

1. RARを展開し、`Barrios Localidades_Alto Parana.geojson` を `CLAVE = '1009'` で絞り込む（28区域：都市6・農村22）。元データのCRSは EPSG:4674（SIRGAS 2000）。
2. AREA別に union して都市1面・農村1面にし、EPSG:4326（WGS 84）へ変換する。簡略化はしていない。
3. 統合面が地区境界を隙間・はみ出しなく覆うこと、都市・農村の重複面積が0であること、全ポリゴンが valid であることを確認した。
4. 人口は統合後の2行にだけ付与し、GeoParquet 1.1.0（geometry は WKB、ZSTD圧縮、29,655 bytes）として書き出す。

処理スクリプトは `scripts/prepare-yguazu.py`、検査値と元ファイルのハッシュは `scripts/day9-verification.json`。いずれもポータルリポジトリ [shinyanakashima/30daymapchallenge](https://github.com/shinyanakashima/30daymapchallenge) の `docs/research/` から引き継いだもの。

```bash
python -m pip install shapely pyproj pyarrow
python scripts/prepare-yguazu.py /path/to/extracted-directory
```

`Ciudades_Alto Parana.geojson` は点データなので、都市の範囲には使っていない。

## ブラウザでの読み込み

アプリは `data/day9-yguazu.parquet` を1回の fetch で取得し、ブラウザ内で GeoParquet を読む。

- [hyparquet](https://github.com/hyparam/hyparquet) で Parquet を読み、ZSTD は [hyparquet-compressors](https://github.com/hyparam/hyparquet-compressors) の展開器だけを渡す。
- hyparquet の GeoParquet 自動変換は使わず（`geoparquet: false`、`utf8: false`）、`geo` メタデータの encoding が WKB、CRS が EPSG:4326 であることを確認したうえで、`src/wkb.ts` で WKB を GeoJSON に復号する。
- 座標が経緯度の範囲にあるか（緯度・経度の入れ替わりがないか）、都市・農村が1行ずつあるかを確認し、MapLibre GL JS の GeoJSON source に渡す。
- 取得や検証に失敗した場合は地図と数値を表示せず、エラーを表示する。代替のデータは使わない。
- 背景タイルは使っていない。地区外は無彩色の背景。

`npm run check` は Node.js で同じファイルを読み、人口合計8,131・比率・ハッシュ・CRSを確認し、`src/wkb.ts` の復号結果が hyparquet 内蔵の復号結果と一致することを検査する。

## 実行

Node.js 22.18 以上（`npm run check` が TypeScript ファイルを直接読むため）。

```bash
npm ci
npm run check    # データ検査
npm run dev      # 開発サーバー
npm run build    # dist/ に静的ファイルを出力
npm run preview
```

主な依存：Vite、TypeScript、MapLibre GL JS 6（worker は別ファイルとして `setWorkerUrl` で指定）、hyparquet、hyparquet-compressors。APIキー・バックエンドは不要。

## デプロイ（GitHub Pages）

`vite.config.ts` の `base: "./"` により、`/30daymapchallenge-2026day9-campo-ciudad/` のようなサブパスでも動く。

1. リポジトリの Settings → Pages → Build and deployment の Source を「GitHub Actions」にする。
2. `main` に push すると `.github/workflows/deploy.yml` が `npm ci` → `npm run check` → `npm run build` を実行し、`dist/` を公開する。Actions タブから手動実行もできる。

## 限界と注意

- 都市・農村はINEが国勢調査で用いた統計上の区分。衛星画像などから判定した市街地や土地被覆とは異なる。
- 境界はINEの統計用の参考境界で、法的な境界を確定するものではない。
- 農村52.74%は人口の割合で、面積の割合ではない。都市区域が小さいことは人口が少ないことを意味しない。
- 人口は都市・農村の2区域単位。元の28区域へは配分しておらず、28区域それぞれに同じ人口を付けて合計すると過大集計になる。
- 人口はPDFの集計表から転記した値。INEが数値を改訂した場合は追随していない。
