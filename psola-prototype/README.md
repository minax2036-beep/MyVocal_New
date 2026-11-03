# My Vocal PSOLA Prototype v0.1.0

My Vocal v0.3.0向けの独立した音程変更エンジン試作です。

## GitHub Pages

リポジトリのGitHub Pagesが `feature/pitch-shift` ブランチを公開元にしている場合、次のパスで開けます。

`/psola-prototype/`

Pagesの公開元が別ブランチの場合は、GitHubの Settings → Pages で公開元を確認してください。既存のルートページは上書きせず、専用サブディレクトリに追加しています。

## ローカル起動

```bash
cd psola-prototype
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000` を開きます。外部ライブラリやネット接続は不要です。

## 試し方

1. 1〜3秒程度の母音「あー」などをWAVで録音します。
2. WAVを読み込みます。
3. +1、+5、+12、-5、-12半音を試します。
4. 元音声と結果を聴き比べ、WAVで保存します。

## 実装内容

- WAV読み込み（Web Audio API）
- YIN方式による簡易F0推定
- 簡易ピッチマーク生成
- PSOLA風のOverlap-Add合成
- F0が検出されない部分は原音を維持
- PCM 16-bit WAV出力
- 音声のサンプル数・長さを維持

## 制限

これはアルゴリズム検証用の初期試作であり、完成版PSOLAではありません。ピッチマークの連続性、無声音との境界、フォルマント補正、子音保護、Web Worker化は未実装です。大きな音程変更では音質が崩れる可能性があります。複数人の声や楽器音は想定していません。
