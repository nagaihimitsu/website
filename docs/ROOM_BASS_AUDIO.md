# Garden-Party Groove の音源

ユーザーから提供された `Garden-Party Groove - usesuno.com.wav` を、同じ3D空間で遊ぶベース演奏に使用しています。操作方式と判定幅は維持し、3難易度の譜面をこの録音に合わせました。

## 原音と配信ファイル

| 項目 | 内容 |
|---|---|
| 原音 | 48,000 Hz、stereo、PCM16 WAV、60.0065秒、11,521,292 bytes |
| 原音SHA-256 | `85fc1320119c86f1c1bd1517600ca9430f0aad7e6ad4b494ca1bd1638cbb867c` |
| 原音のレベル | 約−15 LUFS、true peak約−1 dBFS |
| ゲーム用編集 | 24小節と終わりの余韻、56.14秒。55.29〜56.14秒で両音源を同じようにフェード |
| 伴奏 | [garden-party-backing.mp3](../src/assets/audio/garden-party-backing.mp3)、192 kbps、1,349,036 bytes |
| ベース | [garden-party-bass.mp3](../src/assets/audio/garden-party-bass.mp3)、128 kbps、899,372 bytes |

約2.25 MBの2ファイルをベースに近づいたときに読み込みます。WAV原本や分離モデルはサイトへ配信しません。原音は途中の大きな音量で切れていたため、区切りの拍を使って終端を編集しました。原本は変更していません。

音源の出典はユーザー提供ファイルです。生成サービスの契約プランや原音の再利用許諾は確認しておらず、このリポジトリから第三者への汎用的な楽曲利用許諾を示すものではありません。

## 分離と譜面

KUIELab MDX Track AのbassモデルをCPUで実行し、ベースを推定・抽出しました。伴奏は原音から抽出ベースを引いたものです。処理はローカルで完結し、音源を外部サービスへアップロードしていません。

- [使用モデルの公開配布元](https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/kuielab_a_bass.onnx)
- [上流リポジトリ](https://github.com/kuielab/mdx-net-submission/tree/leaderboard_A)／[MITライセンス](../scripts/licenses/kuielab-mdx-MIT.txt)
- モデルSHA-256：`0c3e77b9963185b1ea6bb46a4b8924137d9370fc1ccdefec7b1b416ef550dcaa`
- 48 kHzの元のサンプル位置と長さにそろえ、圧縮前の2音源の和は原音と最大約`2.98e−8`の誤差。別のTrack Bモデルとのベース波形相関は約0.983。

これは推定した分離音源です。原曲の制作時に書き出した完全な個別トラックではなく、ベースや他楽器の残りがあり得ます。数値検証はサンプル位置・復元精度を確認するもので、聴感上の分離品質の保証ではありません。

テンポは平均約104.7 BPMですが、小さな揺れがあります。[gardenTrack.ts](../src/room/gardenTrack.ts) に実測した拍と、独立した2つの分離結果で音程・周期性を照合した110個のアタックを保持します。タイミングの目安は約±25ms。曖昧なスライド・ゴーストノートは省いており、手採譜による完全な原曲譜ではありません。約2.9〜9.2秒のベースの休みも維持します。

EASY 41音、NORMAL 49音、HARD 54音はこの実測アタックの部分集合です。音の高さを勝手に移調せず、実際の弦とフレットへ対応付けます。開放E弦の音は今回の押弦操作には含めません。ピッキング／スラップの割り当てはゲーム用のアレンジで、原音の全奏法を自動採譜したものではありません。

## 再生と入力

伴奏とベースを同じAudioContext・同じ開始時刻・同じ再開位置で再生し、速度は常に1倍です。成功時のベースは `bassAudio.ts` の `SUCCESS_BASS_GAIN = 2` で約+6 dB強めています。伴奏とマスター音量は維持します。成功した音符の開始から次の譜面音符まで、録音のベースを短い音量ランプで聞こえるようにします。早い成功入力は音符の時刻を待ち、遅い成功入力は残りの区間を再生します。次の音符に失敗するとその区間は閉じます。簡略譜面で省いた細かな音は、成功区間のフレーズに含まれます。

以前の合成伴奏・成功時の合成ベースは重ねません。カウントインと小さな空振り音だけを合成します。成功時の親指・両手・花の演出と、スラップ判定の仕様はそのままです。

音声は開始操作で初めて有効にします。読み込み・デコードが終わってから4拍のカウントを開始し、失敗時は同じ場所で再試行できます。準備中に置く・難易度変更・メニュー表示・画面離脱をしても、遅れて演奏が始まらないようにしています。

メニューや非表示では曲と譜面を停止し、同じ位置から再開します。端末による音声中断でも譜面と採点を止め、「音声を再開」で復帰できます。曲の進行はAudioContextのサンプル時計を基準にし、描画の遅れや端末の時計との差で録音を繰り返し起動し直さないようにしています。譜面・判定・花・キャラクターの拍はその再生位置と実測グリッドに合わせています。

## 音源を作り直す

分離はオフライン制作専用です。サイトのインストールやビルドにPython・FFmpeg・モデルは必要ありません。原本WAVは手元に保管してください。

```bash
python -m venv /tmp/garden-audio-venv
/tmp/garden-audio-venv/bin/pip install numpy scipy soundfile onnxruntime

# 上記の公開配布元からモデルを別途取得。スクリプトはSHA-256を検証します。
/tmp/garden-audio-venv/bin/python scripts/separate-garden-bass.py \
  '/path/Garden-Party Groove - usesuno.com.wav' \
  --model /path/kuielab_a_bass.onnx --output-dir /tmp/garden-stems-new

# FFmpegを用いて同じ区間・フェード・開始位置で2ファイルを生成。
python3 scripts/prepare-garden-audio.py /tmp/garden-stems-new
```

別の曲へ差し替える際は、音源だけでなく `gardenTrack.ts` の拍・アタック・尺も更新します。`bassGame.ts` がそれを難易度別の譜面へ変換します。確認結果は [VALIDATION.md](VALIDATION.md) に記録しています。
