# 部屋の女の子NPC

現在のNPCは、所有者が提供した [GLB原本](https://github.com/nagaihimitsu/website/releases/download/npc-model-v1/_3D.glb) から作った軽量版をThree.jsで表示する。原本の形状・色・材質を引き継ぎ、読み込み中はNPCを表示せず、失敗時は従来の自作モデルを表示する。原本そのものは編集せず、部屋用GLBで重複していた鞄と余分な背面の肩ひもを修復した。鞄はキャラクターの左腰（正面から見て右側）の一つに統一している。

## 提供GLBと配信用データ

| 項目 | 原本 | 部屋用 |
|---|---:|---:|
| ファイル容量 | 50,760,220 bytes | 8,910,304 bytes |
| 三角形数 | 1,413,320 | 218,170 |
| 色テクスチャ | 4096×4096 JPEG | 整理したUVへ元色を転写した4096×4096可逆WebP |
| 表面の凹凸 | 4096×4096 PNG | 2048×2048、可逆WebP |
| 質感マップ | 4096×4096 JPEG | 1024×1024 JPEG |

配信用ファイルは `src/assets/room/visitor.glb`。`?url` importでViteのハッシュ付きアセットとなり、GitHub Pagesの `/website/` 配下でも同じサイトから取得する。Meshopt圧縮のデコーダーは既存のThree.jsに同梱されたものを使い、新たな実行時依存は追加しない。

原本SHA-256: `82a0d456f0582e8bda354e54c9035e3bbe2f2e54a06e7ed2705e63d7e5aa8b34`。部屋用SHA-256: `a7505649b4464c9bc1dbc5d69a90eb342117849ff6379b6f908212f1e886c617`。

以下はリポジトリのルートで、原本を別の作業ディレクトリに保存して実行する、UV整理前のリグ付きモデルまでの生成手順。glTF Transform CLIを4.5.1へ固定し、途中ファイルはリポジトリに入れない。通常のサイトビルドでは再生成しない。

```sh
npx --yes @gltf-transform/cli@4.5.1 weld /path/to/_3D.glb /tmp/visitor-welded.glb
npx --yes @gltf-transform/cli@4.5.1 simplify /tmp/visitor-welded.glb /tmp/visitor-simplified.glb --ratio 0.15 --error 0.0005 --lock-border true
npx --yes @gltf-transform/cli@4.5.1 resize /tmp/visitor-simplified.glb /tmp/visitor-normal.glb --pattern 'NormalGL_*' --width 2048 --height 2048
npx --yes @gltf-transform/cli@4.5.1 resize /tmp/visitor-normal.glb /tmp/visitor-orm.glb --pattern 'ORM_*' --width 1024 --height 1024
python scripts/assets/apply-visitor-bag-repair.py /tmp/visitor-orm.glb /tmp/visitor-repaired.glb
blender -b -t 2 --python scripts/assets/visitor-rig.py -- /tmp/visitor-repaired.glb /tmp/visitor-rig.glb --blend /tmp/visitor-rig.blend
npx --yes @gltf-transform/cli@4.5.1 webp /tmp/visitor-rig.glb /tmp/visitor-textures.glb --slots normalTexture --lossless true
npx --yes @gltf-transform/cli@4.5.1 meshopt /tmp/visitor-textures.glb /tmp/visitor-pre-uv.glb --quantize-position 16 --quantize-texcoord 14 --quantize-normal 12
```

鞄の修復差分は `scripts/assets/visitor-bag-repair.zip` に保存している。適用スクリプトはPython 3とNumPyを使い、軽量化・画像縮小後の入力GLBのSHA-256を照合する。元の頂点の局所修正、不要な面の除去、服・袖・肩ひもの端の補修面と素材を適用する。通常のサイトビルドでは実行しない。差分を適用した未圧縮GLBはリグ生成の入力に使う。`visitor-rig.py` は Blender 4.3.2 と付属NumPy、隣接する `visitor-rig-mask.npz` を使用し、入力SHA-256を照合する。同じ環境で再生成したリグ付きGLBのSHA-256一致を確認済み。Blenderの入出力で三角形が19面減る。頭のスキンウェイトは口と顎を頭に追従させ、首元で胴体へ滑らかにつないでいる。隣接する `visitor-face-morphs.py`・`visitor-breath-morph.py`・`visitor-blink-morph.py`・`visitor-skirt-morph.py` が、口・胸・目元・スカートの形状キーを追加する。

### UV整理版の配信用データ

顔を首から分けて大きく正立させ、髪・ワンピース・カーディガン・鞄や靴の島をまとめた編集用UVに、元の7素材の色を4096×4096へ転写した。その後、髪と衣服の一部の島の向きと余白を調整した `UV_Editable_2` を配信に使用する。編集用Blendには旧UV `UVMap` と前回の `UV_Editable` も残している。配信用GLBの生成時は前回の中間UVをメモリ上だけで除き、色は `UV_Editable_2`、元のノーマル・質感マップは `UVMap` を参照する。補修部の頂点色は色画像に焼き付け済みのため、GLBには頂点色を出力しない。

4K転写画像のUV島外は縮小表示で黒い継ぎ目が出ないよう近傍色を拡張している。島内の画素は維持し、通常のミップマップは使い続ける。顔の口内・側面は補助島に分かれ、部位の混在や局所的な歪み、少量のUV重なりは残る。編集用Blendと元データのコピーは作業環境の `/workspace/npc-animation/uv-study/` に保存され、サイトにはBlendそのものを含めない。元BlendのSHA-256は `aea54883c219ead48fc45d1e632944f2ccc8857a371844c694f508021690a9bc`。

現在の配信用データの再生成には、検証済みの編集用Blend、Blender 4.3.2、glTF Transform CLI 4.5.1を使う。Blendはリポジトリには含まれない。作業環境では `/workspace/npc-animation/uv-study/selected-uv-models/editing/visitor-uv-editable-padded.blend` に保存し、SHA-256は `e97d5b28170e7f1978c66cb480c7784de765aafe0016f12c54690e8553fd97d9`。入力Blendは編集・上書きしない。スクリプトは入力のSHA-256を照合し、既存の出力先への上書きを拒否する。

以下では未使用の一時ファイル名を指定する。出力GLBの確認後、サイトへ反映するときだけ `src/assets/room/visitor.glb` へコピーする。

```sh
blender -b -t 4 --python-exit-code 1 --python scripts/assets/visitor-uv-selected-export.py -- /path/to/visitor-uv-editable-padded.blend /tmp/visitor-selected-raw.glb
npx --yes @gltf-transform/cli@4.5.1 webp /tmp/visitor-selected-raw.glb /tmp/visitor-selected-webp.glb --formats png --lossless true
npx --yes @gltf-transform/cli@4.5.1 meshopt /tmp/visitor-selected-webp.glb /tmp/visitor-selected.glb --quantize-position 16 --quantize-texcoord 14 --quantize-normal 12
```

以下は前回のUV整理版の生成記録で、現在の配信用GLBとは異なる。この手順には検証済み元Blend、Blender 4.3.2、Python 3とNumPy 2.3.5・Pillow 12.3.0・SciPy 1.17.0、glTF Transform CLI 4.5.1を使う。元Blendはリポジトリには含まれない。各スクリプトは入力のSHA-256と出力先を確認する。

```sh
blender -b -t 4 --python-exit-code 1 --python scripts/assets/visitor-uv-export.py -- /path/to/visitor-original.blend /tmp/visitor-uv.glb --texture /tmp/visitor-basecolor-4k.png --blend /tmp/visitor-uv.blend
python3 scripts/assets/visitor-uv-pad-texture.py /tmp/visitor-basecolor-4k.png /tmp/visitor-basecolor-padded.png
python3 scripts/assets/visitor-uv-replace-texture.py /tmp/visitor-uv.glb /tmp/visitor-basecolor-padded.png /tmp/visitor-uv-padded.glb
npx --yes @gltf-transform/cli@4.5.1 webp /tmp/visitor-uv-padded.glb /tmp/visitor-uv-webp.glb --formats png --lossless true
npx --yes @gltf-transform/cli@4.5.1 meshopt /tmp/visitor-uv-webp.glb /tmp/visitor-previous-uv.glb --quantize-position 16 --quantize-texcoord 14 --quantize-normal 12
```

今回の[部屋用モデルの前後・表情比較](screenshots/visitor-selected-uv-comparison.png)。前回の参考画像：[UV配置](screenshots/visitor-uv-layout.png) ／ [部屋用モデルの前後・表情比較](screenshots/visitor-uv-web-comparison.png) ／ [継ぎ目の補正比較](screenshots/visitor-uv-seams-comparison.png) ／ [部屋に近い縮尺](screenshots/visitor-uv-room-scale.png)。

閉眼の参照画像は、所有者提供の閉眼画像（SHA-256 `4004da2a1d7a2555358fceb1e182ad4f672cc7de1e3cc76f732d7c2a193b94de`）から作成する。Python 3 と Pillow を使い、原本を上書きせずに再生成する。

```sh
python3 scripts/assets/visitor-blink-reference.py /path/to/closed-reference.jpg src/assets/room/visitor-blink-reference.png
```

参照画像は 444,678 bytes、SHA-256 `b0c8c35e357ac813f72e5737385b2e4f8ca73dfe2913ea0f5ca6702263f3308f`。通常のサイトビルドでは再生成しない。

## 鞄の修復

提供モデルでは、鞄が左右に重複し、背面の肩ひもが交差していた。正面から右側の鞄と元の前後の斜め掛けひもを残し、反対側の鞄と余分な枝を除いた。鞄・服・袖が一つのメッシュに融合していたため、隠れていたカーディガン、花柄スカート、内側の袖を補い、隣接する元の縁も曲面へ合わせた。

追加の仕上げでは、背中に残っていた短いひもの枝を切除し、主ひもの丸い側面を補った。衣服の深い溝と切れ目状の境界を滑らかなニット面へつなぎ、袖内側に焼き込まれた茶色い跡も既存のニットへなじませた。残した鞄にも後側のふたが重複していたため、その凹凸を局所的に整えて一枚の編み側面へ変更した。前側のふた・留め具と肩ひもの接続位置を保っている。後面の編み地には元の鞄の前面から採った質感を使い、前後の色と凹凸を近づけた。

鞄の修復時は顔・髪・リボン・手足、元の色テクスチャ、部屋での大きさ・配置を維持した。過去の手振り追加時に予約境界を広げ、その後手振りの再生を削除した。

最終確認画像：[編み地の追加調整](screenshots/visitor-bag-weave-comparison.png) ／ [追加修正の比較](screenshots/visitor-bag-refinement-comparison.png) ／ [修正前後の背面](screenshots/visitor-bag-before-after.png) ／ [四方向](screenshots/visitor-bag-four-views.png) ／ [斜め後ろの拡大](screenshots/visitor-bag-rear-detail.png) ／ [鞄の側面](screenshots/visitor-bag-side-detail.png) ／ [部屋・PC](screenshots/visitor-bag-room-desktop.png) ／ [部屋・390px幅](screenshots/visitor-bag-room-mobile.png)。

別の原本へ差し替える場合は、`visitorModel.ts` の正面補正と `MODEL_BOUNDS` を再確認する。現在の原本は+X正面なので、Y軸を−90度回して+Z正面にし、足裏と身長を従来モデルへ合わせている。

確認画像：[部屋・PC](screenshots/visitor-glb-room-desktop.png) ／ [部屋・390px幅](screenshots/visitor-glb-room-mobile.png) ／ [顔アップ](screenshots/visitor-glb-face.png)。

## 従来モデルの造形記録

薄紫の丸いボブと分かれた前髪、紫色の大きい目、黄色のリボン、クリーム色の編み物のカーディガン、紺地に黄・白・緑の花柄ワンピース、茶色の斜め掛けバッグとサンダルを表現する。背面にも髪・カーディガン・肩ひも・花柄を持ち、360度見回せる。

参考画像との反復照合で、短い顎と広い頬、上側が暗く下側が淡い紫の瞳、顔へ沿う開いた笑顔を調整した。髪は連続した丸い頭頂と浅く重なる幅広の毛束、衣服は高めのウエスト・長いスカート・細いケーブル編みで造形する。花と枝葉のプリント、編み鞄の色・凹凸、折り目のあるリボンもコードで生成する。

当時の部屋では元のモデルを縦・横・奥行きとも4/3倍にし、全高約1.70mとしていた。直前の2倍表示から各方向を2/3に縮小したサイズ。[四方向の造形（元のモデル）](screenshots/visitor-comparison.png) ／ [部屋・PC](screenshots/visitor-room-desktop.png) ／ [部屋・390px幅](screenshots/visitor-room-mobile.png)。部屋では既存の照明とシャドウマップを共有する。

仕上げ後の個別画像：[正面](screenshots/visitor-refined-front.png) ／ [斜め](screenshots/visitor-refined-quarter.png) ／ [横](screenshots/visitor-refined-side.png) ／ [背面](screenshots/visitor-refined-back.png) ／ [顔アップ](screenshots/visitor-refined-face.png)。

頭部を集中的に仕上げた画像：[正面・背面・側面の比較](screenshots/visitor-head-comparison.png) ／ [正面アップ](screenshots/visitor-head-front.png) ／ [背面アップ](screenshots/visitor-head-back.png) ／ [参考に近い斜め横](screenshots/visitor-head-reference-side.png) ／ [斜めアップ](screenshots/visitor-head-quarter.png) ／ [右の真横](screenshots/visitor-head-side.png) ／ [左の真横](screenshots/visitor-head-left-side.png)。正面の頭幅・頬・瞳・まつ毛・笑顔、背面の大小の毛束と襟足、側面の鼻・口元・耳・こめかみを順に見比べて調整した。

上の造形説明・旧スクリーンショットは、読み込み失敗時に使う自作モデルの記録。現在のGLBには頭・片腕・手の骨格と `idle`（約4.83秒）・`wave`（約4.17秒）がある。主人公が正面側の視界に入ると、目の高さを目標に頭だけをゆっくり向ける。首の回転は左右14度、上下6度までとし、正面から45〜75度の範囲では視線追従を滑らかに弱め、視界の外では正面へ戻す。近距離の高さの差には完全には追従しない。読み込み失敗時の従来モデルには追従を適用しない。待機中は頭をわずかに傾け、胸元を控えめに動かし、口を開いた笑顔から閉じた表情へ変える。口は顔と一体のため、閉口時の補正曲面を頬寄りに調整しているが、開閉途中には白い輪・影や肌の境界が残る。表情画像の読み込み中や失敗時は元の開いた口を維持する。GLB内の `wave` クリップは残しているが、手首の動きが不自然なため部屋では再生しない。GLBには口・呼吸・目元の形状キーがあり、目元を周囲の顔へなじませながら、所有者の表情差分を加工した画像を重ねてまばたきを表現する。閉眼時の目元の形状を周囲につながるよう控えめに前へ補い、閉眼画像の明るい目の上下を、まつ毛を保ちながら周囲の肌色へなじませる。ときどき口を開いたまま目をゆっくり閉じて笑い、少し保ってから元の表情へ戻る。まつ毛直下の明るさや半開きの目尻には細かな差が残る。画像の読み込み中や失敗時には元の開眼を維持する。歩行も実装していない。従来モデルのまばたきは読み込み失敗時にのみ表示される。メニュー中・タブ非表示中は部屋とともに停止し、「動きを減らす」では追従と装飾的な動きを止めて正面の姿勢に戻る。

[閉眼・閉口の前後形状の比較](screenshots/visitor-expression-depth-comparison.png) ／ [閉口途中](screenshots/visitor-mouth-depth-mid.png) ／ [目元の下側の肌色修正](screenshots/visitor-blink-skin-20261028.png) ／ [目の上側の肌色修正](screenshots/visitor-blink-upper-20261028.jpg) ／ [笑顔の連続姿勢](screenshots/visitor-smile-sequence.jpg)。閉眼時の肌境界の追加試作（未反映）：[前回の比較](screenshots/visitor-blink-skin-study.png) ／ [今回の比較](screenshots/visitor-blink-skin-refinement.png) ／ [閉眼直前の比較](screenshots/visitor-blink-closing-refinement.png)。現在の動き：[まばたきプレビュー](screenshots/visitor-blink-preview.gif) ／ [正面・斜めの連続姿勢](screenshots/visitor-blink-frames.png) ／ [部屋での表示](screenshots/visitor-blink-room.png) ／ [以前の口と呼吸のプレビュー](screenshots/visitor-mouth-breath-preview.gif) ／ [現在の口の開閉](screenshots/visitor-mouth-runtime-comparison.png)。頭の追従時に口の形を保つ修正：[修正前後の比較](screenshots/visitor-mouth-fix-comparison.png)。頭だけを動かした確認画像：[主人公の位置に応じた視線](screenshots/visitor-subtle-gaze.png)。過去の体全体を回した動作の記録：[四方向](screenshots/visitor-look-directions.png)。過去に削除した手振りの記録：[プレビュー](screenshots/visitor-wave.gif) ／ [一場面](screenshots/visitor-wave-frame.png) ／ [部屋での表示](screenshots/visitor-wave-room.png)。

## 実装と更新

- `src/room/art/visitorModel.ts`：GLBの非同期読み込み、待機中の旧モデル非表示と失敗時の代替表示、身長・接地・向きの補正、待機・口・呼吸・まばたき・スカートの形状キーの再生、視界内の主人公に頭を控えめに向ける追従。AnimationMixerの姿勢に頭の回転を合成し、動きを減らす設定では元の姿勢で停止する。`group`・読み込み前から使える `bounds`・`ready`・`animate()`・`dispose()` を返す。退室時にfetchを中止し、画像デコード中に退室しても遅れて完成したGPU資源とImageBitmapを解放する。
- `src/room/art/visitorEyeRelief.ts`：閉眼時の目の形状キーを複製して目元を控えめに前へ補い、口や顎は動かさない。破棄時に元のジオメトリへ戻す。
- `src/room/art/visitorMouth.ts`：まばたきの画像・シェーダーを共有し、顔のメッシュを複製して口元の閉口を描画する。旧モデルや表情画像が使えない場合は口を開いた状態に保ち、破棄時は元のメッシュと素材の設定を復元する。現在の形状では閉口付近の影・輪郭に差が残る。
- `src/room/art/visitorBlink.ts`：閉眼の参照画像を目元に投影し、視線に応じた法線を使用する。読み込み失敗時は開眼を維持し、破棄時にはテクスチャとマテリアルの設定を解放・復元する。
- GLB待機中の全身の揺れは足元を中心に左右と前後へごく小さく傾け、周期の異なる動きを重ねる。上下には移動させず、既存の呼吸の形状キーと頭の待機動作を併用する。腰や脚を独立させる骨はないため、揺れは靴底のずれが小さい範囲に抑えている。スカートは脚や鞄を避けて裾の形状キーを動かし、体の傾きより少し遅れてゆっくり左右に揺れる。「動きを減らす」では正面姿勢へ戻し、解除後は小さい動きから再開する。
- `src/room/art/visitor.ts`：従来モデルの組み立てと待機アニメーション。`createVisitor()` が `group`・`animate(time, reducedMotion)`・`dispose()` を返す。GLBの準備ができた時点で解放する。モデルの正面はローカル+Z。
- `src/room/art/visitorArt.ts`：形状・素材・コード生成テクスチャの共有生成処理と所有リソースの登録。
- `src/room/art/visitorHead.ts`：顔の曲面、目の絵付け、笑顔、頭頂・前髪・重なるボブ。頭部だけを `visitor-head` にまとめ、横幅を元の頭部の0.875倍へ調整。目・鼻・口は共通の曲面に沿わせ、鼻先と口元の起伏、浅い口のくぼみも顔本体へ連続させる。前髪と後ろ髪は閉じた扁平断面で、根元の法線を頭頂へなじませる。後ろ髪の長さ・幅・曲がり・重なりを変え、襟足には下層の束を置く。殻の頂点色素材と、色属性のない内側の球に使う素材は分ける。
- `src/room/art/visitorClothes.ts`：ワンピース、花柄、カーディガン、身頃と袖に沿う細い編み糸。襟元も身頃と連続した曲面にする。
- `src/room/art/visitorAccessories.ts`：編み鞄と革帯、折った布のリボン、一体の手、足と薄いサンダル。リボンはこめかみの曲面に沿う向きで取り付け、下の端を髪の外側へ曲げる。
- `src/room/roomScene.ts`：`room-visitor` の名前で室内の `(1.85, 0.012, -0.70)`、基準のY軸回転 `-0.20rad`、一様スケール `1.4` で配置。全高約1.79m。毎フレーム主人公の足元の座標から目の高さを求めて渡す。机の手前を歩いて回り込める隙間と主人公の初期位置からの通路を残している。
- 従来モデルの可視境界と、正規化したGLBの境界の和を使い、読み込み前後で衝突体を変えない。部屋の変換を適用し、待機中の微動用に元モデルの1.8cmへ表示スケールを掛けた余裕（現在は各方向約2.5cm）を加える。頭の回転にも対応する固定の平面範囲を確保する。サイズや姿勢を変更した場合は、この余裕で両モデルの動く範囲を包含できるか確認する。
- 衝突体は既存の保存位置検証と小鳥の生成より前に存在する。追加NPCと重なる古い保存位置は既存処理が安全な初期位置へ戻し、小鳥も同じ障害物一覧からNPCを避ける。保存形式・復元順序は変更しない。
- 壊せる小物の一覧には登録しない。パンチでも壊れず、「小物を元に戻す」でも位置・形状・衝突体は維持する。
- 形状・素材・テクスチャ・画像の解放は既存の `withDisposalScope` で所有し、切り替え時または部屋の破棄時に一度だけ解放する。GLBの表示または代替モデルの表示、骨格アニメーションの更新を `roomEngine.ts` へ通知し、静止中でも影を描き直す。

GLBは開発サーバーの `/scripts/visitor-model-study.html?view=front`、`side`、`left-side`、`back`、`quarter` で読み込み完了後のモデルを確認する。従来モデルの確認用に `/scripts/visitor-study.html` も残す。`view=reference-side` は70度の斜め横。`focus=face` は肩を含む顔アップ、`focus=head` は頭部を大きく収める。比較ページは開発専用で本番ビルドには含めない。部屋ではPCと狭い縦画面でも確認し、配置変更では家具との隙間と主人公・小鳥の通行を再確認する。

## 検証方法

`npm run test:scope -- npc` は小鳥・NPC造形・GLB読み込み・移動の単体テストと、両NPC・部屋描画のブラウザテストを選ぶ。GLBの専用テストは `tests/room-visitor-model.test.ts`、旧造形は `tests/room-visitor.test.ts`、接触処理は `tests/e2e/visitor.spec.ts`。本番ビルドは `npm run build`。

今回実施した結果と未確認事項は [検証記録](VALIDATION.md) に記載する。過去のキャラクター検証を今回の結果には含めない。

過去の参考画像への造形仕上げはユーザー指定により目視確認と最終撮影のみ。今回のGLB組み込みと過去の造形確認の結果は、検証記録で分けて記載する。
