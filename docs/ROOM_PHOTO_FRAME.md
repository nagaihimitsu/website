# デスクの写真立て

ノート・ペン・コーヒーカップを撤去し、デスク右側に木製の写真立てを置きました。左側のランプと図鑑のスマートフォンはそのままです。

## 造形と配置

- 外寸約76 × 100cm、9度後傾。部屋内の家具・スマートフォンのスケールに合わせています。
- 四隅を留め継ぎにした木枠。表面の丸み、内側の段差、細かな木目を付けています。
- 写真の下に広い余白を取ったクリーム色のマットと、控えめなガラス面。
- 背板、回転式の押さえ金具、ねじ、吊り金具、蝶番と末広がりの支え脚。
- 底を天板の高さ1.36mに合わせ、支え脚までデスク内に収めています。実形状の境界から当たり判定を作っています。

## 画像と出典

写真は2026-10-18にユーザーが添付した「写真単体」のJPEGです。[rome-travel.jpg](../src/assets/room/rome-travel.jpg) に元ファイルをそのまま収録しました。1102 × 1280pxの比率を維持し、写真全体を表示します。写真の生成・描き直し・引き伸ばしは行っていません。

SHA-256: `50f01a47efe5698efbd34d101ac7a8bf03bf09ee948cbb14bad9564047837fa3`

同時に提供された正面・横・背面の写真立て画像を造形の参考にしました。木目はコードで生成し、モデルはThree.jsの形状から作成しています。外部の3Dモデル・画像配信API・追加パッケージは使用していません。

## 更新方法

同じ比率の写真への交換は `src/assets/room/rome-travel.jpg` を置き換えて再ビルドします。比率を変える場合は、[photoFrame.ts](../src/room/art/photoFrame.ts) の写真寸法とマットの開口を合わせて調整してください。配置は [roomScene.ts](../src/room/roomScene.ts) の `photoFrame.group.position` と `rotation.y` で変更できます。

## 確認画像

正面・横・背面・斜めを描画して見比べ、木枠の角、背板の木目、写真の縦横比を修正しました。

[正面](screenshots/photo-frame-front.png) ／ [横](screenshots/photo-frame-side.png) ／ [背面](screenshots/photo-frame-back.png) ／ [斜め](screenshots/photo-frame-quarter.png)

[デスク全体](screenshots/photo-frame-room-desk.png) ／ [部屋での近接表示](screenshots/photo-frame-room-close.png) ／ [背面と支え脚](screenshots/photo-frame-room-back.png)

本番ビルドの表示：[PC](screenshots/photo-frame-app-desktop.png) ／ [390px幅](screenshots/photo-frame-app-mobile.png) ／ [デスク方向・PC](screenshots/photo-frame-app-desk-desktop.png) ／ [デスク方向・390px幅](screenshots/photo-frame-app-desk-mobile.png)。部屋の描画と写真の読み込みを確認し、詳細は [検証記録](VALIDATION.md) にまとめています。
