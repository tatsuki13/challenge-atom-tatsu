# Challenge ATOM Conversation AI

高齢者が毎日気軽に話せる、やさしい会話AIのMVPプロトタイプです。医療機器や診断ツールではなく、孤独感、不安、会話量低下への支援として「話を聞く」「回想を促す」「やさしく質問する」「会話量を記録する」ことを目的にしています。

## MVP機能

- 高齢者向けの大きな文字と大きなボタンの日本語チャットUI
- テキスト会話、ブラウザ対応時の音声入力、読み上げON/OFF
- CSSだけで描画するAI側の小さな相棒アバター
- 危険表現の簡易検知と安全優先の返答
- 感情ラベルの簡易推定
- OpenAI Responses API接続準備
- Neon PostgreSQL向けPrisma schema
- `DATABASE_URL` 未設定時のメモリ保存フォールバック
- 今日の会話回数、発話数、推定時間、文字数、気分スコア、risk件数のKPI表示
- 会話本文をブラウザのlocalStorageやキャッシュに保存しない構成

## セットアップ

```bash
npm install
npm run prisma:generate
npm run dev
```

ローカル起動後、`http://localhost:3000` を開きます。

## 状態ベクトルの可視化

ログイン後、画面上部の「状態の変化」または `/state-vector` を開くと、保存済みの発話の孤独感・不安・楽しさ・関心を時系列で確認できます。期間や会話の絞り込み、発話の選択、直前の発話との差分、数値一覧に対応しています。「最新の履歴を取得」で会話後のデータを読み直せます。対象は選択した期間の最新500発話です。

会話画面の「状態ベクトルの変化」にも、現在の会話のグラフを表示します。返答後に自動更新し、会話を開き直したときは保存済みの値を読み込みます。1発話では点、2発話以降では線で変化を表示します。

未記録のスコアは0で補わず、グラフを途切れさせます。身体データは会話時点の値が保存されていないため、グラフには含めません。サンプルは `/state-vector?demo=1` でログインせずに試せます。サンプルの発話は保存されません。

感情強度はOpenAI APIで、直近8メッセージを参考に最新発話の4軸を独立した0〜1の値として推定します。確率・正答率ではありません。`OPENAI_EMOTION_MODEL`（任意）を指定すると推定用モデルを分けられ、未指定なら `OPENAI_MODEL` を使用します。Structured Outputs対応モデルが必要です。

軸ごとに、推定済みは丸（値が前回と同じでも丸）、判断材料不足で前回値を維持した場合は三角です。初回で材料がない軸は未推定（null）で点を置きません。維持する値は同じ会話内の文脈推定から引き継ぎ、従来のキーワード値は引き継ぎません。API未設定・失敗時も前回値を維持しますが、判断材料不足とは別の理由を記録・表示します。緊急時は安全応答を優先し、推定APIを呼ばずに前回値を維持します。

既存の `Message.emotionScores` JSONに、各軸の数値と `_analysis`（軸ごとの状態・理由・参照した前回メッセージID、推定元、モデル、方式の版）を保存します。DBスキーマの変更は不要です。従来の記録はキーワード推定として区別して表示します。接し方と話題選択は既存のキーワード方式を維持しています。

スコア検証・維持・差分計算は `npm run test:state-vector` で確認できます。

## 環境変数

`.env.example` を参考に、必要な値をローカル環境やVercel環境変数へ設定してください。実値はGitに入れないでください。

```bash
OPENAI_API_KEY=
OPENAI_MODEL=
DATABASE_URL=
NEXT_PUBLIC_APP_NAME="Challenge ATOM Conversation AI"
NEXT_TELEMETRY_DISABLED=1
```

`OPENAI_API_KEY` または `OPENAI_MODEL` が未設定の場合、実APIは呼ばずにモック応答で動きます。`DATABASE_URL` が未設定の場合、会話履歴とKPIはサーバー上のメモリに保存され、再起動で消えます。

## Neon接続

NeonのPostgreSQL接続文字列を `DATABASE_URL` に設定した後、以下を実行します。

```bash
npm run prisma:generate
npm run prisma:push
```

## 品質確認

```bash
npm run prisma:generate
npm run lint
npm run build
```

Next.js 16では `next lint` が削除されているため、lintはESLint CLIで実行します。

## キャッシュ削除

```bash
npm run clean:cache
```

`clean:all` は `node_modules` や `package-lock.json` を削除せず、不要キャッシュ削除後に `npm cache verify` だけを行います。

## Vercel環境変数

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `DATABASE_URL`
- `NEXT_PUBLIC_APP_NAME`
- `NEXT_TELEMETRY_DISABLED`

## プライバシー方針

- 会話本文をブラウザキャッシュ、localStorage、sessionStorage、IndexedDBに保存しません。
- 本人同意なしに家族共有しません。
- 音声入力はWeb Speech APIを使い、録音ファイルを生成・保存しません。
- 読み上げはブラウザの `speechSynthesis` を使い、音声ファイルを生成・保存しません。
- OpenAI Responses API呼び出しでは `store: false` を指定します。
- 医療診断、認知症診断、治療判断はしません。

## 今後の拡張

- ログイン
- 家族共有
- 行政イベント提案
- ロボット連携
- 長期利用分析
- 4週間評価
