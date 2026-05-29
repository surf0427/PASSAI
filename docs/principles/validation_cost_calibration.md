# Validation Cost Calibration（運用ガイド）

COST-1 で導入した固定 token 平均値（`AVG_INPUT_TOKENS_PER_CALL` / `AVG_OUTPUT_TOKENS_PER_CALL`）を、`ai usage` 実測ログから **手動で軽く校正する** ための手順書。
[ai_validation_observability.md](./ai_validation_observability.md) の cost intuition を運用するときの補助 doc。

---

## 1. 目的

- COST-1 の `cost()` helper が出す数値を「実態とそれほどかけ離れていない範囲」に保つ
- AVG 値のドリフトを定期的に直すための **作業手順** を共有する
- calibration は **profitability intuition の補正** が目的であり、**会計精度を目指さない**

これは "AI cost を正確に把握する手段" ではない。`cost()` の出力を眺めたときに桁が大きく外れない、という最低限の感覚を保つだけのレイヤ。

**本 doc の責務境界**

本 doc が **扱うもの**:

- COST-1 の `AVG_INPUT_TOKENS_PER_CALL` / `AVG_OUTPUT_TOKENS_PER_CALL` の手動 calibration 手順
- calibration に伴う averaging philosophy（人間判断 / outlier 除外）
- calibration の禁止事項（自動化 / pricing API / persistence の不採用）

本 doc が **扱わないもの**（それぞれの正本へ）:

- runtime metrics / event 仕様（pass / reject / structure_warning）: [ai_validation_observability.md](./ai_validation_observability.md)
- `ai usage` log の schema / status contract / payload safety: [ai_usage_observability.md](./ai_usage_observability.md)
- `ai cache` log の schema / hit-miss contract / inputHash 仕様: [ai_cache_observability.md](./ai_cache_observability.md)
- observability framework 本体の仕様（3 lane 分離 / DevTools hook / window API）: [ai_validation_observability.md](./ai_validation_observability.md)
- 実観測値の interpretation / 閾値判断（rejectRate 等の hard threshold 化）: 人間の運用判断

→ CAL-1 は observability framework の **補助 doc** であり、runtime source of truth ではない。AVG 定数を持つ単一情報源は [lib/devValidationStats.ts](../../lib/devValidationStats.ts)（COST-1）であり、本書はその更新作業を扱うのみ。

---

## 2. calibration が必要になるタイミング

固定平均値が古くなる典型シナリオ:

| 変更 | なぜ AVG がズレるか |
|---|---|
| prompt caching 大変更（system prompt の構造変更） | 入力 token の cache 比率が変わり、実消費 input tokens の中央値がシフト |
| model routing 導入（軽量 model への分岐） | model 差で input / output 分布が変わる |
| prompt 圧縮（プロンプト本文の削減） | 入力 token 分布の山が下にズレる |
| deterministic reject の閾値変更 | 通過する入力の長さ分布が変わり、結果として AI 入力 token 分布も変わる |
| max_tokens の調整 | 上限変更で output token の頭打ちが変わる |
| 新 route の追加 | 単一平均でカバーしている前提が崩れる |

定期的なリズム（例: 月 1 回）でも、上記の変更があった直後でもよい。**深刻なズレを感じたら見直す** くらいで十分。

---

## 3. calibration の方法（手順）

### 3.1 サンプル収集

dev サーバを起動して、対象 5 route を手動で叩く:
- `/api/statement-review`
- `/api/essay-review`
- `/api/analysis`
- `/api/analysis/additional`
- `/api/summarize`

各 route 5〜10 回程度。サーバ console に出る `ai usage` log を観察:

```
ai usage { route: 'api/statement-review', model: 'claude-sonnet-4-6', status: 'success',
           usage: { input_tokens: 1834, output_tokens: 912, ... }, ... }
```

`input_tokens` / `output_tokens` を手元のメモに転記する。

### 3.2 outlier 除外

転記前に以下を **人間判断で除外** する:

- `status !== 'success'`（`truncated` / `parse_failed` / `failed`）→ token 値が意味的に成立していない
- 異常値（同 route 平均の概ね 3 倍を超える 1〜2 件）→ ストレステスト的入力など
- 1 件目の AI 呼び出し（cache 未温まり）と 2 件目以降が極端に違うなら、定常値だけ採用

3.1 と 3.2 は同じ session 内で完結する作業。再現性は求めない。

### 3.3 平均算出

devtools console から:

```js
import('@/lib/devValidationCostCalibration').then(({ estimateAverageTokens }) => {
  console.log(estimateAverageTokens([1820, 1750, 1780, 1810, 1790]));
});
```

または対象配列を手書きで `(a + b + ...) / n` を電卓で計算してもよい。`estimateAverageTokens` は配列平均 + `Math.round` を返すだけの trivial helper。

### 3.4 AVG 値更新

[lib/devValidationStats.ts](../../lib/devValidationStats.ts) の COST-1 ブロックを手動で書き換える:

```ts
const AVG_INPUT_TOKENS_PER_CALL = 1600;   // 旧 1800、calibration で更新
const AVG_OUTPUT_TOKENS_PER_CALL = 700;   // 旧 900、calibration で更新
```

commit message は実測 calibration の出典がわかる粒度で（例: "calibrate AVG tokens after prompt caching v2 (n=27 across 5 routes)"）。

### 3.5 動作確認

dev を再起動し `__PASSAI_VALIDATION_STATS__.cost()` を 1 回呼び、`estimatedAvoidedTotalTokens` が極端に動いていないこと（または期待方向に動いたこと）を目視確認する。

---

## 4. averaging philosophy

- **exactness 不要**: 1 桁単位の正確性は不要。「100 単位で大ハズレしてない」レベル
- **outlier 除外は人間判断**: 自動トリム / 標準偏差ベース除外などは導入しない
- **全 route 横断の単一平均**: route 別精緻化は future direction、現状は 1 set の AVG で十分
- **session 内サンプリング**: 月跨ぎや日跨ぎの平均は取らない（cache 温度・model 切替などの効果を分離できないため）

数値より「感覚として桁が合っているか」が重視される。

---

## 5. 禁止事項

calibration 名目でも以下は **入れない**:

- pricing API fetch / model 単価の自動取得
- realtime billing 連携
- auto calibration（cron / hook / 自動 ai usage 集計）
- persistent storage（localStorage / Supabase / file への AVG 永続化）
- financial reporting / 経理用途への流用
- network 経由のサンプル収集（log shipping / SaaS への流し込み）
- production runtime での AVG 自動上書き
- `ai usage` / `ai cache` payload contract の変更を伴う calibration

→ いずれも本 doc の "rough intuition" 哲学を超えるため、別 STEP の議論対象になる。

---

## 6. current limitations

calibration を済ませても解消されない、設計上の制約:

- **cache hit 未反映**: `ai cache` の hit 経路を含めた「実 AI 呼出回数」とは別計算（COST-1 は reject 数のみを cost 推計の基礎にしている）
- **route 差を単一平均に潰している**: 例えば analysis（max_tokens=2000）と additional（max_tokens=500）を同じ AVG_OUTPUT で扱う
- **model 差未反映**: model routing が入った場合の per-model AVG は持たない
- **retry / 失敗の重複未反映**: `truncated` / `failed` 再試行が 1 reject に 1 AI call で対応しない
- **system prompt cache discount 未反映**: Anthropic の input cache 割引（read vs creation）を区別しない
- **session-aware ではない**: 同一 user の連続呼び出しによる cache 温度効果を集計に取り込まない
- **時系列を持たない**: prompt 改修前後の AVG 比較は手動 commit log で追う必要がある

これらは "意図的な境界"。受け入れた上で運用する。

---

## 7. future directions

候補だけ列挙。**現時点では実装しない**:

- route 別 AVG（5 set の `AVG_INPUT_<route>` / `AVG_OUTPUT_<route>` 化）
- model 別 AVG（model routing 後の per-model 補正）
- cache-aware estimate（input cache read 割合を掛け合わせ）
- ai usage 実測の自動集計と AVG 自動補正（dev only）
- prod-safe transport（独立 lane を保ったまま SaaS 連携）
- AVG 履歴の改訂履歴自動記録
- per-status calibration（success / truncated / parse_failed の token 分布差を区別）

着手するときは本 doc の対応 section を **先に書き換える**。

---

## 8. optional helper の使い方

[lib/devValidationCostCalibration.ts](../../lib/devValidationCostCalibration.ts):

```ts
export function estimateAverageTokens(samples: number[]): number;
```

- 入力: 数値配列（呼び出し側で outlier を手動除外済み）
- 出力: 単純平均を `Math.round` した整数
- 副作用なし、pure
- log parsing / file read / persistence などは **意図的に持たない**
- `samples.length === 0` のとき `0` を返す（division-by-zero ガード）

呼び方は §3.3 を参照。本 helper は calibration の "電卓" であり、calibration 戦略を表現するものではない。

---

## 9. 関連ドキュメント

- [ai_validation_observability.md](./ai_validation_observability.md) — validation lane の運用正本。本 doc はその cost intuition section の補助
- [ai_usage_observability.md](./ai_usage_observability.md) — `ai usage` log の payload 仕様（calibration の source）
- [ai_cache_observability.md](./ai_cache_observability.md) — `ai cache` log の仕様。cache hit を AVG に反映しない方針の根拠
- [ai_policy.md](./ai_policy.md) — AI 利用全般のポリシー
- [lib/devValidationStats.ts](../../lib/devValidationStats.ts) — COST-1 で `AVG_INPUT_TOKENS_PER_CALL` / `AVG_OUTPUT_TOKENS_PER_CALL` を保持する単一情報源
- [lib/devValidationCostCalibration.ts](../../lib/devValidationCostCalibration.ts) — trivial helper

---

## 10. 改訂履歴

- 2026-05-28: 初版（CAL-1）。COST-1 の AVG 値を手動 calibration するための手順書を整備。trivial helper `estimateAverageTokens` を同時導入。
- 2026-05-28: CAL-2（docs 統合）。§1 目的の末尾に "本 doc の責務境界" を追記し、ai_validation_observability.md（運営正本）と本 doc（calibration 補助）の責務分離を明文化。runtime / payload contract / helper 実装 / AVG 定数 すべて不変、docs only。
