# Personal Atlas

訪れた国と都道府県、登った日本百名山、出会ったポケモンを静かに公開する、個人のコレクションサイト。正式仕様は [企画書・実装仕様書](docs/SPECIFICATION.md) です。

React + TypeScript + Viteによる静的サイトです。ログイン・DB・管理画面・ブラウザ編集機能・閲覧時の外部API通信はありません。実績は空の9個のTXTから始まり、架空の記録や写真を本番表示しません。

## 開発・確認

Node.js 22.12以上（検証環境：24.19.0）とnpmを使用します。

```bash
npm ci
npm run dev
npm run validate:data
npm run test
npm run test:e2e
npm run test:subpath
npm run build
npm run preview
```

ブラウザテストではChromiumを使用します。ローカルにない場合は `npx playwright install chromium`。Linuxの `/usr/bin/chromium` を自動検出し、それ以外はPlaywright管理のブラウザを使用します。`CHROMIUM_PATH` で指定も可能です。依存OSライブラリがない場合は `npx playwright install --with-deps chromium` を利用してください。

`build` はデータ検証→TypeScript検査→静的ビルドを実行。`dist/` を配信します。既存チェックアウトをそのまま使用できます。

## 最短の更新方法

1. `public/data/訪問した国.txt` に、実際に訪れた国を1行追加（例：`イタリア`）。保存してページを再読み込みすると件数と地図が変わります。
2. 写真を追加するなら `npm run photos -- /原本/写真.jpg public/photos/countries/italy/01.webp`。
3. `public/data/記録_国.txt` に `イタリア|2025-05|countries/italy/01.webp` の形式で実際の記録を追記。日付が不明なら空欄で構いません。
4. `npm run validate:data && npm run test && npm run build` を実行して、TXTと写真をGitに反映・再公開。

実績だけなら手順2〜3は不要です。通常色と色違いは別々のTXTへ記入します。再訪・再登頂は詳細TXTに同じ項目で複数行を追加します。

[9ファイルの書式・写真追加方法](docs/DATA_FORMAT.md) に全書式とエラー例をまとめています。上記の説明用記録は本番ファイルに入れていません。

## 実装範囲

- ホーム＋4コレクションのハッシュルート。PCの2列カード、スマホの縦配置。
- 黒とシルバーの配色、大きなタイポグラフィ、実際の地理データによる地球の線画。Space Groteskをローカル配信し、動きの軽減設定にも対応。
- 世界2D SVG地図と遅延読み込みの3D地球儀。同じ訪問ID集合で着色。回転・ズーム・国選択。WebGL非対応時は2Dへ復帰。
- 47都道府県すべての県境と一覧。訪問状態を独立集計。
- 日本百名山100座すべてのマーカー・名称・標高・代表峰。ズーム・移動・検索・一覧から詳細選択。
- 全国図鑑基本種1,025種の番号・日本語名・英語名。番号/名前検索、捕獲済み/未捕獲、世代選択、60種ごとのページング。
- 通常色・色違いを独立管理し、通常のみ／色違いのみ／両方／未捕獲を表示。捕獲種数は和集合。
- 任意精度の日付、再訪・再登頂、複数写真、写真切替と拡大。右パネル／モバイルのボトムシート、Escapeとフォーカス復帰。
- TXTの別名正規化・重複警告・不正日付・未知名・実績不整合・危険なパス・欠損写真のビルド前検証。
- 写真の向き補正・縮小・WebP書き出し・EXIF除去。

## データと権利

- 世界地図：Natural Earth 5.1.2（Public domain）
- 国名・ISO：i18n-iso-countries 7.14.0（MIT）
- 日本：jpn-atlas 1.0.2（BSD-3-Clause）、国土地理院「地球地図日本」2016を加工
- 百名山：mountix（MIT）の地理院地図リンク付き代表峰座標を100座に選定
- ポケモン：PokéAPI CSVの2026-10-18取得スナップショット（BSD-3-Clause）

[取得元・ライセンス・加工・ポリゴンの対象範囲](docs/DATA_SOURCES.md)、[100座の代表峰と照合](docs/MOUNTAIN_AUDIT.md)、[デザイン方針](docs/DESIGN.md) を参照してください。出典の固定ファイルを再検証する場合のみ `npm run verify:sources` を実行します。通常のTXT更新にネットワーク取得は不要です。

## 公開

`base: './'` とハッシュルーティングのため、ドメイン直下でも `/website/` 配下でも配信できます。明示的なパス指定が必要なら `ATLAS_BASE=/website/ npm run build`。

GitHub Pagesの場合：

1. コードをリポジトリに反映する。
2. Settings → Pages → Sourceを **GitHub Actions** にする。
3. `main` にpushするか、Actions → **Publish Personal Atlas** → **Run workflow** を実行する。
4. 以後のTXT・写真更新も `main` に反映すると、検証後に自動で公開する。

ワークフローは `main` へのpushまたは手動実行で起動し、検証・テスト後に `dist/` を配信します。GitHub PagesのSourceは事前に **GitHub Actions** へ設定してください。公開完了はActionsの成功と、deployジョブが出力するURLで確認します。他の静的ホスティングでも `dist/` をアップロードすれば利用できます。

## 検証と残る範囲

検証結果は [VALIDATION.md](docs/VALIDATION.md)。PC/360px幅の画面画像は [screenshots](docs/screenshots/)。テスト用実績・画像は通信モックおよび無視対象の `.test-build/` 内だけで使用します。

MUST要件は実装済み。全国図鑑は採用時点の1,025基本種を固定し、将来の追加種はマスター更新が必要です。独立した地図形状のない3地域は一覧と記録で対応し、地図では誤って着色しません。地球儀の主要ライブラリは大きいため3D選択時のみ読み込みます。

SHOULDのフォーム拡張に備えて `speciesId` と `variant` を分離しています。リージョン・姿違い・メガ進化の別集計は初版の対象外です。ポケモン画像は権利未確認のため未使用で、仕様のテキスト図鑑方式を採用。実際の個人記録・写真・正式サイト名・独自ドメインは所有者が追加・変更できます。

公開TXTと写真は誰でも取得可能です。写真は公開用に変換しても、写り込んだ顔・住所・予約情報などの内容は自分で確認してください。原本を公開フォルダに置かず、Git履歴にも残さない運用を推奨します。
