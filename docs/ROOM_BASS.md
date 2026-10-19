# テラスのベース演奏

部屋のドアをパンチで開けて外へ出ると、花壇のそばにベースとアンプがあります。楽器・スタンド・アンプ・ケーブル・花はコードで造形しています。演奏中も同じ3D空間を表示し、画面下に音符が流れるバーを重ねます。

## 遊び方

1. ベースの近くで**連続して5秒**待ちます。円形ゲージが満ちる前に離れると、ゲージが消えて時間もリセットされます。
2. 主人公がベースへ手を伸ばして持ち、演奏位置へ少し移動します。カメラも奏者が見える向きへ滑らかに回ります。
3. **「演奏する」／Space／F／J**で開始。3拍のカウントダウン後、右から流れる音符が判定線と重なったところで弾きます。

| 操作 | PC | スマートフォン |
|---|---|---|
| ベースまで歩く | WASD／矢印キー | 左下のスティック |
| 演奏を開始 | 「演奏する」／Space／F／J | 「演奏する」をタップ |
| 弾く | Space／F／J | 「弾く」をタップ |
| 途中で終える・置く | Esc／「置く」 | 「置く」をタップ |
| 再挑戦 | 結果画面の「もう一度」／Space／F／J | 「もう一度」をタップ |

持っている間は移動・ジャンプ・パンチを止め、腕の動きでピッキングを表現します。置いた後は一度その場から離れると、再び5秒の滞在で持てます。メニューを開いた間やタブを非表示にした間は演奏時間と音を止め、復帰時にその続きから進みます。

## 譜面と音

初版は**EASYのみ、96 BPM・24音符・約20.6秒**のオリジナル譜面です。判定はPERFECTが前後85 ms、GOODが前後180 ms。同じ音符を重複して採点せず、空振りは減点とコンボ解除になります。成功した音符に応じて花壇が開花し、終了時にスコア・精度・最高コンボを表示します。

ベース音と短い伴奏はWeb Audioで合成します。外部の楽曲・録音・サンプルを使わず、追加ダウンロードもありません。近づいただけでは音を鳴らさず、開始ボタンやキーの操作で音源を起動します。Web Audioが使えない環境では無音でプレイできます。

譜面・難易度は1つだけです。選曲、追加難易度、スコア保存・ランキングは実装していません。演奏によってコレクションのTXTや実績は変更しません。

## 実装と確認

| ファイル | 役割 |
|---|---|
| [art/bassGarden.ts](../src/room/art/bassGarden.ts) | ベース、アンプ、スタンド、花壇と追従するケーブル |
| [bassGame.ts](../src/room/bassGame.ts) | 5秒滞在、持ち上げ、演奏時間、譜面、採点 |
| [bassAudio.ts](../src/room/bassAudio.ts) | 操作時の音源起動、伴奏、弾いた音、停止と解放 |
| [BassGameHUD.tsx](../src/room/BassGameHUD.tsx)／[bassGame.css](../src/room/bassGame.css) | 円形ゲージ、演奏バー、PC・タッチ操作、結果 |
| [bassGameStore.ts](../src/room/bassGameStore.ts) | 小さな演奏UIだけへの状態通知 |
| [roomEngine.ts](../src/room/roomEngine.ts)／[roomScene.ts](../src/room/roomScene.ts)／[art/character.ts](../src/room/art/character.ts) | 部屋への接続、カメラ、持ち上げ・演奏姿勢、衝突判定 |

関連範囲だけを検証するコマンドです。

```bash
npm run test:scope -- music
npm run build
```

`music` は演奏判定・音声・エンジンとモデルの解放を単体テストし、ブラウザでPC／タッチの演奏、ドアとテラス、部屋描画を確認します。`npm run test:scope -- music --list` で対象一覧を表示できます。公開ワークフローの手動実行も `validation: music` に対応します。

確認画像：[花壇と楽器](screenshots/bass-garden.png)／[持った姿](screenshots/bass-ready-desktop.png)／[PCの演奏](screenshots/bass-playing-desktop.png)／[スマートフォンの演奏](screenshots/bass-playing-mobile.png)。実行結果は [VALIDATION.md](VALIDATION.md) を参照してください。
