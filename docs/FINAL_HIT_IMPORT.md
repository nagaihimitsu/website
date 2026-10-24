# 「最終のヒット」のMIDI譜面取り込み

2026-10-24。添付AGENTS.mdと [取り込み指示の原文](music/final-hit/04_CODEX_IMPORT_INSTRUCTIONS.md) に従い、原曲再生位置とJSONの絶対秒を接続した。指板・タイムライン・主人公・3D背景・既存のサンプラーとAudioContextは継続使用する。

## 選曲と現段階の範囲

ベースを持った後の「曲」でGarden-Party Grooveと最終のヒットを選ぶ。既存曲のEASY／NORMAL／HARDはそのまま残し、新曲は難易度による自動間引きをせず「MIDI仮譜面」とする。

| 入力／出力 | 件数・意味 |
|---|---|
| `01_midi_all_notes.json` | MIDI由来の原本648音。提供されたバイト列のまま保存 |
| `02_bass_4string_candidates.json` | 標準4弦・24Fの未確認候補557音。提供されたバイト列のまま保存 |
| 原本から候補の段階の対象外 | 91音。元の除外IDを保持 |
| 現行24ボタンで演奏可能 | MIDI28〜48の315音。0F〜5Fで弾ける実位置を使用 |
| 24F候補にはあるが現行指板の範囲外 | 242音。移調せずに対象外として記録 |

データは `src/room/charts/final-hit/` にある。除外の全333音について、`05_fretboard_import_report.json` に元ID、時刻、MIDI音高、理由を保存する。先頭n0001は0.789583秒のE3（MIDI52）であり、原本にも除外記録にもそのまま残す。先頭が0秒になるようなシフトや、E2へのオクターブ変更は行っていない。

原本と候補は自動採譜由来で、原曲のベースだけを保証するものではない。`positionVerified=false`、`technique=null`、`techniqueVerified=false`、`audioSyncVerified=false`を維持する。奏法不明は`kind=tap`で仮表示するが、内部のtechniqueをpickへ書き換えない。保持時間・velocity・元IDと原時刻も保持し、奏法の確定には使わない。明示的に`kind=hold`へ修正した音だけ、保存したdurationSecを保持判定へ使う。

## 音源と同期

ユーザー提供「最終のヒット.wav」は48kHz・stereo・PCM16、2,880,648フレーム、60.0135秒。SHA-256は `8502b7d6ce574ea8a38681962997bca96ec7b5c54e3c114f2d3abc54968e2aa2`。

配信には `src/assets/audio/final-hit.mp3`（192kbps）を使用する。切り詰め・無音除去・正規化・曲速変更は行わず、ブラウザ向けに圧縮した。原音と配信ファイルのSHA、フレーム数、生成条件は `audio-source.json` に記録する。原WAVは今回の添付を正本として保持し、約11.5MBの原本をそのまま毎回ダウンロードさせない。

再生成:

```bash
python3 scripts/prepare-final-hit-audio.py '/path/最終のヒット.wav'
```

MIDIの長さ59.596875秒と音源の長さを別に扱い、元音源の余韻まで再生する。MIDI内120BPMはカウント・アニメーション用メタ情報で、ノーツ時刻の再計算には使用しない。目標時刻は必ず`timeSec + audioOffsetSec`。既存のWeb Audioサンプル時計を唯一の進行基準とし、フレーム数で曲を進めない。正オフセットで末尾が音源の外へ出る場合は、その最後の判定まで無音の余裕を確保する。

準備画面の「譜面調整」はミリ秒で指定し、プラスでノーツを遅らせる。初期値は0ms。端末の保存設定は`personal-atlas-bass-audio-offset-v1`に曲ごとに保持し、記録TXTや既存の部屋sessionStorageは変更しない。オフセットの変更だけでは同期確認済みへ切り替えない。

添付WAVは原曲ミックスなので、ベースも録音内に含まれる。原曲ミックスは原速・1本で再生し、ボタン入力時には既存Gardenの分離ベースを使うMIDIサンプラーを控えめに重ねる。新たなステム分離や奏法推定は実施していない。曲を替えると古い読込・デコード・予約音を無効化し、同じAudioContextと曲別キャッシュで再開する。

## 運指・奏法の修正と保存

提供原本は編集せず、`overrides.json`へ修正を保存する。次のコマンドは開発用で、ウェブの個人記録編集機能ではない。

```bash
# 同じMIDI音高の候補位置を表示（現行指板で表示できるかも出力）
npm run chart:final-hit -- --positions n0006

# n0006=G2を2弦5Fへ修正。奏法は明示した場合だけ指定する
npm run chart:final-hit -- --note n0006 --string 2 --fret 5 --position-verified true
npm run chart:final-hit -- --note n0006 --technique slap --technique-verified true

# 不明へ戻す。表示種別を変える場合はkindも明示する
npm run chart:final-hit -- --note n0006 --technique unknown --kind tap --technique-verified false

# 保持ノーツとして確認する場合（長さは元のdurationSec）
npm run chart:final-hit -- --note n0006 --kind hold

# 同期オフセットを秒で指定。正確さを確認した場合だけフラグも指定する
npm run chart:final-hit -- --offset 0.12
npm run chart:final-hit -- --sync-verified true

# ベース以外の混入を確認して除外する場合
npm run chart:final-hit -- --note n0006 --exclude true

# 現行指板への適合・対象外の記録を更新
npm run chart:final-hit -- --report src/room/charts/final-hit/05_fretboard_import_report.json
```

弦番号は1=G、2=D、3=A、4=E。フレットの適合は開放弦MIDI＋フレットで検証し、不一致・未対応バージョン・不正な時刻などは保存前に拒否する。運指が5Fを超える場合も修正元の選択は保存し、画面は同じMIDIの0〜5F位置を使う。この代替表示位置のpositionVerifiedはfalseとし、実運指の確認状態はsourcePositionVerifiedに残す。技法名は文字列のまま保存できるが、現在の操作が対応するのはtap／hold／slapである。

同時刻の音はそのまま複数指で入力でき、IDごとに判定する。開発上モノフォニックにしたい場合だけ次を使う。

```bash
npm run chart:final-hit -- --monophonic /tmp/final-hit-mono.json
```

同時刻は低い音を先にし、前の音のMIDI保持区間に重なる音を間引く開発用規則である。時刻・音高は変えず、取り除いた候補は`/tmp/final-hit-mono.excluded.json`へ出す。原本・元の候補・通常プレイの315音は変えない。生成譜面を正しいベースパートと断定しない。

## 状態と責務

- `bassChartImport.ts`: バージョン・原本との一致・運指・時間を検査し、既存BassSongへ変換。通信・保存を行わない。
- `finalHitTrack.ts`: 添付JSON、修正ファイル、音源長を結び付ける。
- `bassGame.ts`: 選曲、共通の判定状態、曲単位オフセット、練習用シーク。シーク時は点数をリセットし、過去ノーツをskippedとして採点対象から外す。
- `bassAudio.ts`: 同じデバイス時計で再生・停止・再開・明示的シーク。短いシークもドリフト許容値で無視しない。
- `RoomEngine`: 既存の部屋操作経由で以上を統合。毎フレームの3D状態をReactへ移さない。

新曲は密集音符向けにタイムラインを300px/秒、必要時は3段の補助配置で表示する。横位置と間隔は絶対秒に比例し、判定時刻やタイムラインの高さは変えない。既存曲は従来の200px/秒を維持する。

## 今回の確認

変更前は単体249件が成功。変更後は262件が成功し、JSONの版・件数・時刻・MIDI・運指、未知奏法、同時刻ノーツ、全315音の判定、停止・再開・シーク、古いデコードの無効化、修正の保存・原本保護、別出力のモノフォニック化を検証した。型検査・本番ビルド・`/website/`配下の検査も成功した。

ブラウザで新曲の選択、実MP3のデコード（60.0135秒）と原速、オフセット付き表示と判定、停止再開、既存曲への復帰、曲変更時の遅延開始防止を確認した。原曲とMIDIの聴感による照合、正しいベースパートの選別、実演奏の運指・奏法、iOS Safari実機確認は未実施であり、確認済みフラグを立てていない。

## Ver.2.1 スライドの手動追加

既存譜面は自動変更しません。明示的に指定するslide修正は、`--kind slide --technique slide`と、同一弦1〜5Fの始点、`--end-string`、`--end-fret`、音声内の絶対秒`--end-time`を指定します。詳細は [奏法拡張](BASS_V21_VALIDATION.md)。位置・奏法の確認フラグは別指定で維持します。
