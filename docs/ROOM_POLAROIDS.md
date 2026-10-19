# ローテーブルのポラロイド写真

カメラ右側にあったカップと受け皿を撤去し、白い縁の付いた10枚の旅行写真を置いています。向きの異なる写真が重なる、ユーザー提供の参考図に合わせた配置です。

## 素材と造形

2026-10-19に提供された参考画像の上面図を、そのまま1枚の共有テクスチャとして使用しています。元ファイルは [polaroid-travels.jpg](../src/assets/room/polaroid-travels.jpg)（1280×960px）。写真の内容を生成・描き直しする処理はありません。

各写真は独立した薄い紙の立体です。白い縁のある表、クリーム色の裏面と紙の側面、重なりの高さ、小さな縁の反りを表現しています。参考図の写真が隠れている部分は同じ順序で重ねています。素材は提供された合成画像の解像度に準じ、未提供の元写真を補完していません。

部屋の旅行記録・訪問実績とは独立した装飾です。記録TXTへの写真・日付の追加は行いません。

## 更新方法

- 造形・各写真の位置・画像上の参照範囲：[tablePolaroids.ts](../src/room/art/tablePolaroids.ts)。
- テーブル上の配置：[roomScene.ts](../src/room/roomScene.ts) の `tablePolaroids.group`。天板の高さは0.635mです。
- 元画像を差し替える場合は、各写真の参照範囲も新しい画像に合わせて更新します。

テクスチャはシーンが所有し、写真モデル側は紙の形状・材質と独自の影を解放します。新しいパッケージや外部APIは使用していません。

## 確認画像

[上面](screenshots/table-polaroids-top.png) ／ [斜め](screenshots/table-polaroids-quarter.png) ／ [紙の重なり](screenshots/table-polaroids-edge.png) ／ [裏面](screenshots/table-polaroids-underside.png)

[テーブル全体](screenshots/table-polaroids-room-table.png) ／ [近接](screenshots/table-polaroids-room-close.png) ／ [テーブル上面](screenshots/table-polaroids-room-top.png)

[PC](screenshots/table-polaroids-app-desktop.png) ／ [390px幅](screenshots/table-polaroids-app-mobile.png)。確認範囲は [VALIDATION.md](VALIDATION.md) に記録しています。
