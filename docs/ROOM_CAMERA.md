# ローテーブルのカメラ

ローテーブル左側の雑誌を撤去し、シルバーと黒のカメラを置きました。レンズを部屋の入口側へ少し斜めに向け、底面を天板の高さ0.635mに合わせています。右側のカップと受け皿は、[重ねたポラロイド写真](ROOM_POLAROIDS.md)に置き換えています。

## 造形

ユーザーが2026-10-18に提供した、正面・背面・上面・左右のカメラ参考図を基に、Three.jsで立体を作成しました。

- 角を丸めたシルバーのボディ、黒い革の表面とグリップ。
- 上部の傾斜したファインダー部分、ホットシュー、シャッターボタン、ダイヤル。
- 段差のある鏡筒、細い溝の付いた操作リング、奥に収めた青灰色のレンズ。
- 背面モニター、ファインダー、十字ボタン、親指を添えるグリップ。
- 左右のストラップ用金具と側面のカバー。

モデルと素材の細かな模様は独自実装です。革・レンズ・底面の接触影をコードで生成し、サイト内で描画しています。

部屋内では約56 × 35 × 34cmの大きさで配置しています。底面の薄い接触影で、天板との接地を表現しています。

## 配置の変更

モデルは [tableCamera.ts](../src/room/art/tableCamera.ts)、配置は [roomScene.ts](../src/room/roomScene.ts) の `tableCamera.group` で管理します。`position` が位置、`rotation.y` が向き、`scale` が大きさです。当たり判定は配置後のモデルの境界から作成しています。

## 確認画像

[正面](screenshots/table-camera-front.png) ／ [背面](screenshots/table-camera-back.png) ／ [左](screenshots/table-camera-left.png) ／ [右](screenshots/table-camera-right.png) ／ [上面](screenshots/table-camera-top.png) ／ [斜め](screenshots/table-camera-quarter.png)

[ローテーブル全体](screenshots/table-camera-room-table.png) ／ [部屋での近接表示](screenshots/table-camera-room-close.png) ／ [部屋での背面](screenshots/table-camera-room-back.png)

本番ビルドの確認：[PC](screenshots/table-camera-app-desktop.png) ／ [390px幅](screenshots/table-camera-app-mobile.png) ／ [初期表示](screenshots/table-camera-app-default-desktop.png)。検証の範囲は [VALIDATION.md](VALIDATION.md) に記録しています。
