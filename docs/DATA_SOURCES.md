# 静的マスターの出典

取得日：2026-10-18（日本時間）。閲覧時の外部API通信はありません。全データを静的同梱しています。バージョン・コミット・元ファイルのSHA-256は `src/catalogs/provenance.json` と `scripts/catalogs/sources.json` に固定しています。

| データ | 採用元・範囲 | 利用条件・加工 |
|---|---|---|
| 世界の国境 | [Natural Earth 5.1.2](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2)、50m Admin 0 Map Units | Public domain。[利用条件](https://www.naturalearthdata.com/about/terms-of-use/)。属性削減、座標丸め、mapshaperで18%に簡略化（keep-shapes）。D3用にリング方向を統一。 |
| 国・地域名とISOコード | [i18n-iso-countries 7.14.0](https://github.com/michaelwittig/node-i18n-iso-countries) | MIT。ISO 3166-1正式割当の249項目。パッケージ独自のXKは対象外。日本語名・英語名・別名を静的保存。 |
| 日本47都道府県 | [jpn-atlas 1.0.2](https://github.com/biskwikman/jpn-atlas) | BSD-3-Clause。元資料は国土地理院「地球地図日本」2016（[公開案内](https://www.gsi.go.jp/kankyochiri/gm_jpn.html)、[国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)）。本サイトは同データを加工して作成。投影済みTopoJSONを47県GeoJSONへ変換し、平面上0.3px相当で簡略化。 |
| 日本百名山の代表峰・座標・標高 | [codemountains/mountix](https://github.com/codemountains/mountix)、コミット `1325247de2465c10b5b01f71496dc26c96b2b240` の `migrations/data/mountix_db-mountains.json` | MIT。各元レコードの地理院地図へのリンクを保存。推測した座標は使用せず、選定した代表峰の値をそのまま採用。 |
| 全国図鑑の基本種 | [PokéAPI CSV](https://github.com/PokeAPI/pokeapi/tree/5ee47a9a9c1229632ec4b473a9c1c53026e005dd/data/v2/csv) の `pokemon_species.csv`、`pokemon_species_names.csv` | PokéAPI BSD-3-Clause。1〜1025、基本種全件・日本語（language_id=11）・英名・世代。フォームを別計上しない。 |

ライセンス全文は `public/licenses/` に収録し、配信物にも含めます。Pokémonおよびキャラクター名はNintendo等の権利者の商標です。本サイトは非公式の個人記録です。キャラクター画像・スプライトは利用していません。ソフトウェアのOSSライセンスを画像の利用許諾とは扱いません。

## フォント

英字は [Space Grotesk](https://github.com/google/fonts/tree/main/ofl/spacegrotesk)（SIL Open Font License 1.1、ウェイト300〜700）。Google Fontsリポジトリの可変TTFをfontToolsでWOFF2へ可逆変換し、`public/fonts/` に収録しています。ブラウザではローカルファイルだけを読み込みます。出典とライセンス全文は同フォルダの `README.txt`、`SpaceGrotesk-OFL.txt`。日本語はOSフォントを使用します。

## 部屋・キャラクター・スマートフォン

家具、植物、布、iPhone風スマートフォン、小物と破片はThree.jsで作成したオリジナル形状です。操作キャラクターは、ユーザーから提供された正面・側面・背面の参考画像をもとに、茶色の動物、グレーのパーカー、クリーム色のリュック、しっぽをコードで立体化しています。参考画像を公開アセットとして同梱したり、外部の3Dモデルを取得したりはしていません。原神・ゼルダの伝説・3Dマリオは移動と追従カメラの操作感の参考であり、各作品のモデル・テクスチャ・音源・UI画像は使用していません。

キャラクターの毛並み、綿の編み目、リブ、キャンバス地の織り目は `src/room/art/characterMaterials.ts` が生成する独自のテクスチャです。色・凹凸・表面の粗さを生成し、外部の素材画像を読み込みません。輪郭の短毛、フードの折れ目、リュックのふくらみと縫い目も自作の形状です。

頭部の連続曲面と耳・顔は `characterHead.ts`、局所座標で形を保つ楕円の目と星は `characterEyes.ts`、根元をつないだ耳前の毛束は `characterTufts.ts`、服・しっぽ・関節は `characterBody.ts`、折り畳んだフードと紐は `characterHood.ts`、手と靴は `characterExtremities.ts`、リュックと肩紐は `characterBackpack.ts` に分け、`character.ts` が組み立て・動作・リソース解放を担当します。毛・布・綿の紐の素材画像も `characterMaterials.ts` で生成し、外部の3Dモデルや素材画像は使用していません。目の艶に使う小さな反射マップもコードで生成し、読み込み画像や外部サービスは使いません。比較用ページ `scripts/character-study.html` も実際の部屋と同じモデルを読み込み、`focus=face` で顔を拡大確認できます。このページは本番ビルドの入口に含めません。

操作について公式ページへアクセスを試みた結果と、本サイトで採用したカメラの仕様を [CONTROLS.md](CONTROLS.md) に記録しています。各ゲーム固有の挙動を公式資料で確認済みとする記述は行っていません。

画面の図形・文字も独自に描画し、AppleのロゴやiOSの画像素材、ポケモンのキャラクター画像、ゲーム音声は使用していません。壁の世界地図・日本地図は上記の静的マスターをCanvasで描き、実際の訪問IDに連動して着色します。部屋の小物を架空の旅行・登頂実績として扱いません。

## 国の範囲とポリゴン

「訪問○か国」はISO国・地域マスターに登録したユニークな実績数です。国連加盟国のみのカウントではありません。分母・達成率は表示しません。

Natural Earthの `ISO_A3_EH` → `ISO_A3` → `ADM0_A3` の順で対応を確認し、ISOの項目に対応しない境界は中立色で表示します。訪問した別の国に勝手に付け替えません。国境はNatural Earthのスナップショットに基づく地理表現です。

次の3地域は、この縮尺のポリゴンに独立した対応がなく、一覧・記録を正として扱います：ブーベ島、ジブラルタル、合衆国領有小離島。詳細パネルにも地図非表示の注記を出します。フランス本土と仏領ギアナ等は別々のISO IDに対応。英国の複数地理単位はGBRへ統合し、ヤンマイエン島はスヴァールバル諸島と共通のSJMへ明示的に対応させています。小島の輪郭は縮尺により省略・簡略化されます。

## 百名山の照合

固定対象は深田久弥『日本百名山』の100座。`mountix` の `百名山` タグは機械的に採用していません。タグのままでは同名別山が含まれるため、名称・地域・代表峰を対応させて `scripts/catalogs/mountain-selection.json` に行IDを固定しました。

- 薬師岳は北アルプスの薬師岳。北上の同名峰を除外。
- 笠ヶ岳は北アルプスの笠ヶ岳。志賀の同名峰を除外。
- 乗鞍岳は剣ヶ峰3026m。白馬乗鞍岳を除外。
- 男体山は日光、木曽駒ヶ岳は木曽山脈、甲斐駒ヶ岳は南アルプス。
- 穂高岳は奥穂高岳、八ヶ岳は赤岳、大峰山は八経ヶ岳、荒川岳は悪沢岳、草津白根山は本白根山を代表峰として採用。
- 大山は元資料の剣ヶ峰の位置。一般登山の到達点・安全なルートを保証するピンではありません。

全100座の選定行・代表峰・座標と比較資料との差を [MOUNTAIN_AUDIT.md](MOUNTAIN_AUDIT.md) に記録しています。比較には [hyakumeizan-map](https://github.com/startFromBottom/hyakumeizan-map) の名称と位置の事実情報を使用。比較資料は山塊中心・別峰・誤差を含むため、その座標を混ぜたり平均したりしていません。地理院の一次資料を全点再測量したものではなく、出典付きの掲載座標を採用した静的マスターです。

## マスターの再検証・将来更新

```bash
npm run verify:sources
```

元資料6ファイルを固定URLから取得し、記録済みSHA-256と照合して `.cache/catalogs/` に保存します。TLSやハッシュ検証を省略せず、不一致は停止します。アプリのマスターを自動上書きしません。

通常の実績更新ではこのコマンドは不要です。将来基本種が追加された場合のみ、出典バージョン・件数・変換内容をレビューしてマスターと `provenance.json` を更新します。全国図鑑番号の連続性、100山の代表峰、47県の形状、別名の衝突を `npm run validate:data` で検証してください。

世界地図だけを固定ソースから再生成する場合は、`npm run verify:sources` の後に `npm run catalogs:world`。変換ツールmapshaper 0.7.88はこのときのみ取得し、通常の開発依存には含めません。生成後はデータ検証と地図のブラウザテストを実行してください。

WORLDの地域分類（SUBREGION）と代表点は同じ固定Natural Earthの表示属性から抽出し、別の `world-view.json` に同梱。地理的重心の平均ではなくLABEL_X／LABEL_Yを使う。形状のない3地域のみ概略点を補い、BVT（3.35E,54.42S）、GIB（5.35W,36.14N）、UMI（ミッドウェー177.37W,28.21N）と表示上の注記を保存する。UMIの代表点は分散した島々の中心を意味しない。[更新手順](COLLECTION_MODES.md)。

地域は大陸単位から23の小地域へ細分化した。日本語名・順序・外洋の島々の例外と境界地域の扱いは [WORLDの地域分類](WORLD_REGIONS.md) を参照。統治国の所在へ海外領土を集約せず、既存249IDと訪問TXTは維持する。
