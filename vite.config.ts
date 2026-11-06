import { defineConfig } from "vite";

// GitHub Pages のサブパス（/リポジトリ名/）でも動くよう相対パスで出力する
export default defineConfig({
  base: "./",
  // MapLibre 本体が大半を占めるため警告の閾値を上げる
  build: { chunkSizeWarningLimit: 1400 },
});
