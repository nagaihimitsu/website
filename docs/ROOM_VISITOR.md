# 部屋の女の子NPC

現在のNPCは、所有者が提供した [GLB原本](https://github.com/nagaihimitsu/website/releases/download/npc-model-v1/_3D.glb) から作った軽量版をThree.jsで表示する。原本の形状・色・材質を引き継ぎ、読み込み中・失敗時は従来の自作モデルを表示する。原本そのものは編集せず、提供モデルにある左右のリボン・バッグも維持する。

## 提供GLBと配信用データ

| 項目 | 原本 | 部屋用 |
|---|---:|---:|
| ファイル容量 | 50,760,220 bytes | 6,504,428 bytes |
| 三角形数 | 1,413,320 | 211,998 |
| 色テクスチャ | 4096×4096 JPEG | 同じJPEGを維持 |
| 表面の凹凸 | 4096×4096 PNG | 2048×2048、可逆WebP |
| 質感マップ | 4096×4096 JPEG | 1024×1024 JPEG |

配信用ファイルは `src/assets/room/visitor.glb`。`?url` importでViteのハッシュ付きアセットとなり、GitHub Pagesの `/website/` 配下でも同じサイトから取得する。Meshopt圧縮のデコーダーは既存のThree.jsに同梱されたものを使い、新たな実行時依存は追加しない。

原本SHA-256: `82a0d456f0582e8bda354e54c9035e3bbe2f2e54a06e7ed2705e63d7e5aa8b34`。部屋用SHA-256: `41465261e07290c0538678ad9d6b525c4a47407e3d1c75bda91e6eab5ce7eee0`。

以下はリポジトリのルートで、原本を別の作業ディレクトリに保存して実行する再生成手順。glTF Transform CLIを4.5.1へ固定し、途中ファイルはリポジトリに入れない。通常のサイトビルドでは再生成しない。

```sh
npx --yes @gltf-transform/cli@4.5.1 weld /path/to/_3D.glb /tmp/visitor-welded.glb
npx --yes @gltf-transform/cli@4.5.1 simplify /tmp/visitor-welded.glb /tmp/visitor-simplified.glb --ratio 0.15 --error 0.0005 --lock-border true
npx --yes @gltf-transform/cli@4.5.1 resize /tmp/visitor-simplified.glb /tmp/visitor-normal.glb --pattern 'NormalGL_*' --width 2048 --height 2048
npx --yes @gltf-transform/cli@4.5.1 resize /tmp/visitor-normal.glb /tmp/visitor-orm.glb --pattern 'ORM_*' --width 1024 --height 1024
npx --yes @gltf-transform/cli@4.5.1 webp /tmp/visitor-orm.glb /tmp/visitor-textures.glb --slots normalTexture --lossless true
npx --yes @gltf-transform/cli@4.5.1 meshopt /tmp/visitor-textures.glb src/assets/room/visitor.glb --quantize-position 16 --quantize-texcoord 14 --quantize-normal 12
```

別の原本へ差し替える場合は、`visitorModel.ts` の正面補正と `MODEL_BOUNDS` を再確認する。現在の原本は+X正面なので、Y軸を−90度回して+Z正面にし、足裏と身長を従来モデルへ合わせている。

確認画像：[部屋・PC](screenshots/visitor-glb-room-desktop.png) ／ [部屋・390px幅](screenshots/visitor-glb-room-mobile.png) ／ [顔アップ](screenshots/visitor-glb-face.png)。

## 従来モデルの造形記録

薄紫の丸いボブと分かれた前髪、紫色の大きい目、黄色のリボン、クリーム色の編み物のカーディガン、紺地に黄・白・緑の花柄ワンピース、茶色の斜め掛けバッグとサンダルを表現する。背面にも髪・カーディガン・肩ひも・花柄を持ち、360度見回せる。

参考画像との反復照合で、短い顎と広い頬、上側が暗く下側が淡い紫の瞳、顔へ沿う開いた笑顔を調整した。髪は連続した丸い頭頂と浅く重なる幅広の毛束、衣服は高めのウエスト・長いスカート・細いケーブル編みで造形する。花と枝葉のプリント、編み鞄の色・凹凸、折り目のあるリボンもコードで生成する。

部屋では元のモデルを縦・横・奥行きとも4/3倍にし、全高約1.70m。直前の2倍表示から各方向を2/3に縮小したサイズ。[四方向の造形（元のモデル）](screenshots/visitor-comparison.png) ／ [部屋・PC](screenshots/visitor-room-desktop.png) ／ [部屋・390px幅](screenshots/visitor-room-mobile.png)。部屋では既存の照明とシャドウマップを共有する。

仕上げ後の個別画像：[正面](screenshots/visitor-refined-front.png) ／ [斜め](screenshots/visitor-refined-quarter.png) ／ [横](screenshots/visitor-refined-side.png) ／ [背面](screenshots/visitor-refined-back.png) ／ [顔アップ](screenshots/visitor-refined-face.png)。

頭部を集中的に仕上げた画像：[正面・背面・側面の比較](screenshots/visitor-head-comparison.png) ／ [正面アップ](screenshots/visitor-head-front.png) ／ [背面アップ](screenshots/visitor-head-back.png) ／ [参考に近い斜め横](screenshots/visitor-head-reference-side.png) ／ [斜めアップ](screenshots/visitor-head-quarter.png) ／ [右の真横](screenshots/visitor-head-side.png) ／ [左の真横](screenshots/visitor-head-left-side.png)。正面の頭幅・頬・瞳・まつ毛・笑顔、背面の大小の毛束と襟足、側面の鼻・口元・耳・こめかみを順に見比べて調整した。

上の造形説明・旧スクリーンショットは、読み込み中に使う自作モデルの記録。現在のGLBも床で待機し、既存の部屋の更新処理でごく小さく上下・左右へ揺れる。GLBにはボーン・表情モーフ・アニメーションが含まれないため、GLBのまばたきや歩行は実装していない。従来モデルのまばたきは読み込み中にのみ残る。メニュー中・タブ非表示中は部屋とともに停止し、「動きを減らす」で装飾的な動きを止める。

## 実装と更新

- `src/room/art/visitorModel.ts`：GLBの非同期読み込み、身長・接地・向きの補正、待機動作。`group`・読み込み前から使える `bounds`・`ready`・`animate()`・`dispose()` を返す。退室時にfetchを中止し、画像デコード中に退室しても遅れて完成したGPU資源とImageBitmapを解放する。
- `src/room/art/visitor.ts`：従来モデルの組み立てと待機アニメーション。`createVisitor()` が `group`・`animate(time, reducedMotion)`・`dispose()` を返す。GLBの準備ができた時点で解放する。モデルの正面はローカル+Z。
- `src/room/art/visitorArt.ts`：形状・素材・コード生成テクスチャの共有生成処理と所有リソースの登録。
- `src/room/art/visitorHead.ts`：顔の曲面、目の絵付け、笑顔、頭頂・前髪・重なるボブ。頭部だけを `visitor-head` にまとめ、横幅を元の頭部の0.875倍へ調整。目・鼻・口は共通の曲面に沿わせ、鼻先と口元の起伏、浅い口のくぼみも顔本体へ連続させる。前髪と後ろ髪は閉じた扁平断面で、根元の法線を頭頂へなじませる。後ろ髪の長さ・幅・曲がり・重なりを変え、襟足には下層の束を置く。殻の頂点色素材と、色属性のない内側の球に使う素材は分ける。
- `src/room/art/visitorClothes.ts`：ワンピース、花柄、カーディガン、身頃と袖に沿う細い編み糸。襟元も身頃と連続した曲面にする。
- `src/room/art/visitorAccessories.ts`：編み鞄と革帯、折った布のリボン、一体の手、足と薄いサンダル。リボンはこめかみの曲面に沿う向きで取り付け、下の端を髪の外側へ曲げる。
- `src/room/roomScene.ts`：`room-visitor` の名前で室内の `(1.85, 0.012, -0.70)`、Y軸回転 `-0.20rad`、一様スケール `4 / 3` で配置。机の手前を歩いて回り込める隙間と主人公の初期位置からの通路を残している。
- 従来モデルの可視境界と、正規化したGLBの境界の和を使い、読み込み前後で衝突体を変えない。部屋の変換を適用し、待機中の微動用に元モデルの1.8cmへ表示スケールを掛けた余裕（現在は各方向2.4cm）を加える。サイズや姿勢を変更した場合は、この余裕で両モデルの動く範囲を包含できるか確認する。
- 衝突体は既存の保存位置検証と小鳥の生成より前に存在する。追加NPCと重なる古い保存位置は既存処理が安全な初期位置へ戻し、小鳥も同じ障害物一覧からNPCを避ける。保存形式・復元順序は変更しない。
- 壊せる小物の一覧には登録しない。パンチでも壊れず、「小物を元に戻す」でも位置・形状・衝突体は維持する。
- 形状・素材・テクスチャ・画像の解放は既存の `withDisposalScope` で所有し、切り替え時または部屋の破棄時に一度だけ解放する。GLBの読み込み完了を `roomEngine.ts` へ通知し、静止中でも旧モデルの影を描き直す。

GLBは開発サーバーの `/scripts/visitor-model-study.html?view=front`、`side`、`left-side`、`back`、`quarter` で読み込み完了後のモデルを確認する。従来モデルの確認用に `/scripts/visitor-study.html` も残す。`view=reference-side` は70度の斜め横。`focus=face` は肩を含む顔アップ、`focus=head` は頭部を大きく収める。比較ページは開発専用で本番ビルドには含めない。部屋ではPCと狭い縦画面でも確認し、配置変更では家具との隙間と主人公・小鳥の通行を再確認する。

## 検証方法

`npm run test:scope -- npc` は小鳥・NPC造形・GLB読み込み・移動の単体テストと、両NPC・部屋描画のブラウザテストを選ぶ。GLBの専用テストは `tests/room-visitor-model.test.ts`、旧造形は `tests/room-visitor.test.ts`、接触処理は `tests/e2e/visitor.spec.ts`。本番ビルドは `npm run build`。

今回実施した結果と未確認事項は [検証記録](VALIDATION.md) に記載する。過去のキャラクター検証を今回の結果には含めない。

過去の参考画像への造形仕上げはユーザー指定により目視確認と最終撮影のみ。今回のGLB組み込みと過去の造形確認の結果は、検証記録で分けて記載する。
