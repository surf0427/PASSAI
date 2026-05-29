# AI Validation Observability（運用ガイド）

deterministic validation layer の役割と、運用中に何を見るか・何を見ないかの正本。
[ai_usage_observability.md](./ai_usage_observability.md) / [ai_cache_observability.md](./ai_cache_observability.md) と並ぶ第 3 の lane。

---

## 1. 目的

- AI を呼ぶ「前段」で deterministic に invalid 入力を弾く layer（validator）と、構造弱さを軽くヒントする layer（structure warning）の観測指針を固める
- 「AI を呼ばずに deterministic に判定した瞬間」を独立 log key (`[ai validation]`) で観測し、集計クエリ・SLI を AI cost lane と分離する
- 数値の解釈・false positive 哲学・操作的ガイドを明文化し、validator threshold / structure warning 文言の変更判断を一貫させる

実装の単一情報源は既存ファイル（[lib/aiValidationLog.ts](../../lib/aiValidationLog.ts) / [lib/devValidationStats.ts](../../lib/devValidationStats.ts) / [lib/validation/](../../lib/validation/) 配下）が優先される。本書は **運用と判断のレイヤ** のみ扱う。

---

## 2. なぜ別 lane か

AI 周りには 3 つの観測責務がある。各 lane の log key と集計クエリは互いに **混ぜない**。

| lane | log key | 観測対象 | payload の中心 |
|---|---|---|---|
| AI usage | `ai usage` | 実際に AI を呼んだときの token / model / status | `usage.input_tokens` / `usage.output_tokens` / `status` |
| AI cache | `ai cache` | AI を呼ばずに保存済み結果で済んだ瞬間（hit / miss） | `inputHash` / `action` |
| **AI validation** | **`[ai validation]`** | **AI を呼ぶ前の deterministic 判定（pass / reject / structure warning）** | **`route` / `code` / `codes`** |

別 lane にする理由:

- **責務が異なる**: usage は cost、cache は reuse、validation は gating。同じクエリで束ねると指標が歪む（例: cache hit を usage に混ぜると平均 token が下がる）
- **payload contract を独立に保つ**: usage / cache の field を増やさずに validation の knob だけ動かせる
- **集計クエリの安定性**: STEP4.x で固めた `ai usage` の status contract、STEP5.x で固めた `ai cache` の action contract をいじらない

→ validation lane の改修（threshold 調整・新 code 追加など）は他 2 lane の集計を **壊さない**ことを構造的に保証する。

---

## 3. deterministic layer の責務

### 3.1 これは AI の代替ではない

validator / structure warning は **AI 前段の runtime health layer** であり、AI の判定を置き換える層ではない。

- スコアリングしない
- 添削しない
- 採点しない
- 「正解」を出さない
- AI 出力品質に関与しない

役割は次の 2 点のみ:

1. **obvious invalid** な入力で AI を起動しない（コスト・latency・unstable response の削減）
2. **obvious weak structure** を軽く UI ヒントとして可視化する（rewrite 続行を促す）

### 3.2 ai_policy.md との整合

[ai_policy.md](./ai_policy.md) は「AI に本文を代筆させない」原則。本層はこれを **補強する**:

- validator: 本文未入力で AI を起動しない → AI 出力を読み写すような誤用経路を狭める
- structure warning: 構造弱さを deterministic に示し、ユーザー自身の rewrite を促す（AI 代筆経路に誘導しない）

---

## 4. event 仕様

3 event を独立 type として持つ discriminated union。AI flow に介入せず、観測としてのみ log + counter を更新する。

### 4.1 `validation_pass`

| 項目 | 内容 |
|---|---|
| 発火条件 | validator が `{ ok: true }` を返した瞬間（client-side のみ） |
| 意味 | "obvious invalid ではない" だけ |
| **意味しない** | AI success / quality / correctness / 完成度 |
| payload | `{ type, route }` のみ |
| log | `[ai validation] pass route=<route>` |
| stats | `totalPasses` / `passByRoute[route]` を +1 |

pass は reject rate の **分母**として存在する。pass 単独で「良い」とは言わない。

### 4.2 `validation_reject`

| 項目 | 内容 |
|---|---|
| 発火条件 | validator が `{ ok: false, code, message }` を返した瞬間（client + server fallback の両方） |
| 意味 | deterministic に invalid と判定された入力 |
| **意味しない** | quality 不足 / 採点低い / 改善余地あり |
| payload | `{ type, route, code }` |
| log | `[ai validation] reject route=<route> code=<code>` |
| stats | `totalRejects` / `rejectByRoute[route]` / `rejectByCode[code]` を +1 |

reject code 4 種:

| code | 意味 | trigger 例 |
|---|---|---|
| `EMPTY` | trim 後に空 | `''` / `'  \n  '` |
| `TOO_SHORT` | route 別の最小長 (statement 100 / essay 80 / analysis 30) 未満 | "あ" のみ |
| `REPEATED_CHAR` | 10 chars 以上 かつ 同一 code-point 比率 ≥ 0.8 | "ああああああああああ" |
| `PLACEHOLDER` | `'未入力'` / `'あとで書く'` / `'(仮)'` / `'仮入力'` を含む | 仮入力残存 |

route ごとの rule 採用は [lib/validation/](../../lib/validation/) 配下の per-route validator が正本。

### 4.3 `structure_warning`

| 項目 | 内容 |
|---|---|
| 発火条件 | `detectStructureWarnings(text).length > 0` のとき（client-side のみ、statement-review / essay-review のみ） |
| 意味 | **non-blocking** な heuristic hint |
| **意味しない** | scoring / grading / 採点 / correctness / 改善義務 |
| payload | `{ type, route, codes: string[] }` |
| log | `[ai validation] warning route=<route> codes=<code1>,<code2>` |
| stats | `totalWarnings` +1、`warningByCode[code]` を code ごとに +1 |

warning code 5 種:

| code | heuristic |
|---|---|
| `LOW_PARAGRAPH_COUNT` | 改行区切り < 2 段落 |
| `LOW_SENTENCE_COUNT` | `。！？!?` 区切り < 3 文 |
| `MISSING_REASON_PATTERN` | "なぜなら / 理由 / ため / きっかけ" のいずれも未含有 |
| `NO_CONCLUSION_PATTERN` | "志望 / 学びたい / 将来 / 目指 / 取り組" のいずれも未含有 |
| `CONJUNCTION_BIAS` | 接続詞合計 ≥ 3 かつ最頻出比率 ≥ 0.7 |

warning は AI flow を **止めない**。validator pass 後に並列で UI に表示するのみ。

---

## 5. derived metrics の読み方

`__PASSAI_VALIDATION_STATS__.metrics()` で取得できる:

```ts
{
  overall: { rejectRate, warningRate },
  byRoute: { [route]: { passCount, rejectCount, rejectRate } }
}
```

全て 0〜1 の raw float。formatting は呼び出し側の責務。

### 5.1 `rejectRate`

式: `reject / (reject + pass)`、分母 0 → 0。

| 観測値 | 解釈の候補 |
|---|---|
| **高すぎる** | validator が厳しすぎる / placeholder 文言の UX 誘導が弱い / onboarding が足りない |
| 低すぎる（≒ 0） | 入力品質が高い、または **validator が緩すぎて素通ししている** 可能性 |
| 安定して中程度 | 既存 threshold が運用感に合っている |

rejectRate は単体では意味を持たない。何を入力として受け取ったか / どの code が頻発しているかと組み合わせて読む。

### 5.2 `warningRate`

式: `totalWarnings / totalPasses`、分母 0 → 0。
warning は pass の subset として扱う（warning が出ても validator は pass）。

| 観測値 | 解釈の候補 |
|---|---|
| 高すぎる | structure guidance が不足 / rewrite サポート UX が弱い / heuristic が厳しすぎる |
| 低い | 入力が構造化されている、または heuristic が緩い |

warning は UI に非破壊で出すだけのため、rate が高くても **AI cost 影響はゼロ**。rate は UX 改善判断のためにだけ見る。

### 5.3 `byRoute[r]`

route 単位の `passCount` / `rejectCount` / `rejectRate`。

- ある route だけ reject rate が突出 → その route の validator threshold か入力 UX を見直す
- ある route の passCount が他より明らかに少ない → mount 経路 / button gating の問題かも

route 横断比較で初めて意味を持つ指標。

---

## 6. false positive philosophy（最重要）

PASSAI の deterministic layer は **reject precision を優先**する。

> 「多少通してしまう」ほうを優先する。「誤って弾く」を最警戒する。

### 6.1 なぜか

- 誤 reject の UX コスト: ユーザーが書いた本文が "弾かれた" 体験は信頼を失う / rewrite 動機を削ぐ / AI 代筆経路に誘導されない設計が崩れる
- 過剰 pass のコスト: AI 1 回分の token + latency。同じ入力で繰り返せば cache hit。再現性は十分
- 採点責務は AI 側にある。deterministic 層は「明らかに無意味な入力」のみ弾けばよい

→ 不確実なケースは **必ず pass 側に倒す**。validator threshold は控えめに、structure warning は non-blocking のままに保つ。

### 6.2 設計上の表現

- TOO_SHORT 閾値は控えめ（statement 100 / essay 80 / analysis 30）。短いが意味のあるドラフトは通す
- REPEATED_CHAR は 10 chars 以上 + 0.8 比率と厳しい（短文での誤 trip を避ける）
- PLACEHOLDER は完全一致 substring のみ（部分一致や類似語に踏み込まない）
- additional / summarize は conversational 段階のため TOO_SHORT を採用しない
- structure warning は **block しない**

### 6.3 改修判断

新しい reject code / warning code を足したくなったら、まず以下を自問:

1. 「誤 reject」が増える設計か？（増えるなら諦める）
2. AI 出力 が今すでにできていることを deterministic に再現しようとしていないか？（しているなら諦める）
3. 「reject の precision」ではなく「reject の recall」を上げる動機か？（後者なら諦める）

→ 3 つ全てに「No」が言えない限り、reject code は増やさない。warning へ降格、または完全に見送る。

---

## 7. operational guidance

### 7.1 何を見るか

| 観察対象 | 見るタイミング |
|---|---|
| `metrics().overall.rejectRate` | dev session の最後 / バグ報告調査時 |
| `metrics().byRoute[r].rejectRate` | 特定 route の UX 苦情を受けたとき |
| `get().rejectByCode` | 「どこを直すか」を判断するとき |
| `get().warningByCode` | structure heuristic を緩めるか厳しくするか判断するとき |
| `[ai validation] reject` log の連続 | session 中の挙動を流し見するとき |

### 7.2 heuristic guidance（hard threshold ではない）

以下は経験則。**正解の閾値ではない**。

- `rejectRate > 0.4` が継続: validator が厳しすぎる、または onboarding に問題がある可能性。`rejectByCode` で trigger を特定
- `rejectByCode.PLACEHOLDER` が多い: UI で placeholder 文言が「初期値」と誤認されている可能性
- `rejectByCode.TOO_SHORT` が支配的: UX 上の最小文字数案内が機能していない可能性
- `warningRate > 0.6` が継続: structure guidance UI が不足 / rewrite 支援を増やす余地
- ある warning code だけ突出: heuristic が誤検知している可能性。閾値を緩める or 撤去を検討

### 7.3 改修フロー（推奨）

1. dev で `metrics()` / `get()` を眺める
2. 仮説を 1 つ立てる（例: TOO_SHORT が多すぎる → threshold を 100 → 80 に下げる）
3. 関連 validator を 1 ファイルだけ編集
4. dev で再観測
5. 効果がなければ revert（validator は per-route 1 ファイルで rollback 容易）

threshold 変更で `[ai validation]` の集計分布は変わるが、`ai usage` / `ai cache` には影響しない。

---

## 8. devtools usage

dev session 中、ブラウザ DevTools Console から:

```js
// 全 raw counter
__PASSAI_VALIDATION_STATS__.get()
// → {
//     totalPasses, passByRoute,
//     totalRejects, rejectByRoute, rejectByCode,
//     totalWarnings, warningByCode,
//   }

// 算出済み rate
__PASSAI_VALIDATION_STATS__.metrics()
// → {
//     overall: { rejectRate, warningRate },
//     byRoute: { [route]: { passCount, rejectCount, rejectRate } },
//   }

// cost intuition（rough heuristic、AVG は手動 calibration）
__PASSAI_VALIDATION_STATS__.cost()
// → {
//     estimatedAvoidedCalls, estimatedAvoidedInputTokens,
//     estimatedAvoidedOutputTokens, estimatedAvoidedTotalTokens,
//     byRoute: { [route]: { avoidedCalls } },
//   }

// route 別 economics（rough heuristic / dev intuition 用）
__PASSAI_VALIDATION_STATS__.getRouteEconomics()
// → [
//     {
//       route, validations,
//       avoidedCalls,
//       estimatedSavedInputTokens, estimatedSavedOutputTokens,
//     }, ...
//   ]

// counter を初期化（session 内でクリーンに再計測したいとき）
__PASSAI_VALIDATION_STATS__.reset()
```

production build では `window.__PASSAI_VALIDATION_STATS__` 自体が `undefined`（[lib/installDevValidationStatsHook.ts](../../lib/installDevValidationStatsHook.ts) が NODE_ENV gate で install しないため）。本番 DevTools から評価しても TypeError になるだけ。

**route economics layer の責務境界（OBS-3）**

`getRouteEconomics()` は既存 metrics（`get()` / `cost()`）を route 単位で aggregate して「どの route の deterministic 層が work を avoid しているか」感覚を掴むだけの read-only view。新しい runtime instrumentation は **追加していない**。

- **rough heuristic only**: 固定 AVG token を route 別 avoided calls で按分しているだけ。実 token / 実 billing とは別物
- **avoidance ≠ actual saved billing**: 以下は **一切反映していない**
  - Anthropic input cache read 割引（cache hit のときの実 input token 減）
  - retry / `truncated` / `parse_failed` による複数 attempt
  - hidden overhead（pre-flight / network round-trip）
  - model 別単価 / route 別 max_tokens 差
- **profitability intuition** のみ。production KPI / 経理用途 / 財務報告には流用しない
- 値の interpretation は **人間判断**（rejectRate / 節約 token 量を hard threshold 化しない）
- "deterministic optimization の方向を見るための補助レンズ"。finance system ではない

実装は [lib/devRouteEconomics.ts](../../lib/devRouteEconomics.ts) — `aggregateRouteEconomics()` 1 関数のみ。AVG 定数の直接参照を避け、cost helper の総量を avoidedCalls 比で按分するため、CAL-1 calibration で AVG が動いても自動追従する。

**cost estimate と AVG token calibration**

`cost()` は固定平均値（`AVG_INPUT_TOKENS_PER_CALL` / `AVG_OUTPUT_TOKENS_PER_CALL`）から rough に算出する helper。実態がドリフトしたら手動で AVG を見直す。

- calibration 手順の正本は [validation_cost_calibration.md](./validation_cost_calibration.md)（CAL-1）。本書は cost intuition の運用面のみ扱う
- COST-1 の AVG 値を変更するときは必ず CAL-1 の §3 手順に従い、commit message に出典（サンプル数 / トリガー）を残す
- 自動 calibration / pricing API 連携 / persistence は **intentionally unsupported**（CAL-1 §5 禁止事項）
- averaging は **人間判断**: outlier 除外・session 内サンプリング前提。標準偏差ベース自動 trim は導入しない（CAL-1 §4 averaging philosophy）

---

## 9. current limitations

明文化（これらは **欠陥** ではなく **意図的な境界**）:

- dev-only — production では log / counter 共に no-op
- no persistence — process memory のみ、リロード / プロセス再起動で消える
- no session tracking — user / session 単位の集計はしない
- no analytics SaaS — network 送信は行わない
- no time-series — rolling window / time-bucket は持たない
- no user segmentation — A/B test 集計層は別
- no route × warning code matrix — cross-tab は未実装
- AI cost estimation は rough heuristic — `cost()` は固定 AVG token で算出。route 差 / cache hit / model 差を反映しない。AVG 値は [validation_cost_calibration.md](./validation_cost_calibration.md) の手順で人間判断による手動 calibration
- route economics は集計 view であり新計測なし — `getRouteEconomics()` は既存 `get()` / `cost()` を route 単位に束ねるだけ。`avoidedCalls` は **deterministic reject 数** であって "AI を呼んだはずなのに呼ばずに済んだ実回数" ではない（cache hit / retry / hidden overhead は別レーンの責務）
- server-side `validation_pass` 不発火 — client 主導の指標として一意にしている
- structure warning は statement-review / essay-review の 2 route のみ — analysis-flow は適用範囲外

---

## 10. future directions

候補だけ列挙。**現時点では実装しない**。

- prod-safe transport（独立 lane を保ったまま SaaS / Supabase 連携）
- route × warning code cross-tab（warning の route 分布、code 共起）
- AI cost 削減推計の精緻化（COST-1 で rough heuristic 実装済 / CAL-1 で手動 calibration 整備済。route 別 AVG / cache-aware / model 別 / 単価掛け合わせは未実装）
- deterministic structure analysis の reject 化（warning → soft reject へ昇格させるか継続検討）
- model routing optimization（reject 直前段階で軽量 model に倒す ramp）
- session-aware aggregation（同一 session 内の連続 reject を別レンズで見る）
- threshold の per-route / per-user 調整機構
- doc-prompt 同期化（prompt 側 placeholder 文言と validator placeholder list の対応表）

future directions は本書を更新するきっかけになる。各候補に着手するときは本書の該当 section を必ず先に書き換えてから実装する。

---

## 11. 関連ドキュメント

- [ai_policy.md](./ai_policy.md) — AI 利用全般のポリシー（本層がこれを補強する）
- [ai_score_contract.md](./ai_score_contract.md) — AI 数値スコア route の整合性ルール
- [ai_cache_observability.md](./ai_cache_observability.md) — `ai cache` lane の正本
- [ai_usage_observability.md](./ai_usage_observability.md) — `ai usage` lane の正本
- [validation_cost_calibration.md](./validation_cost_calibration.md) — COST-1 の AVG token 値を人間判断で手動 calibration する手順書（CAL-1。本書の補助 doc）
- [architecture_rules.md](./architecture_rules.md) — code 配置・責務境界
- [feedback_dev_principles.md](./feedback_dev_principles.md) — STEP 分割 / コラボ姿勢
- [lib/aiValidationLog.ts](../../lib/aiValidationLog.ts) — `[ai validation]` log key の単一情報源
- [lib/devValidationStats.ts](../../lib/devValidationStats.ts) — counter / derived metrics の実装
- [lib/installDevValidationStatsHook.ts](../../lib/installDevValidationStatsHook.ts) — DevTools hook の install
- [lib/devRouteEconomics.ts](../../lib/devRouteEconomics.ts) — route economics aggregation の実装（OBS-3。既存 metrics の read-only view、新規 instrumentation なし）
- [lib/validation/](../../lib/validation/) — per-route validator / structure warning helper

---

## 12. 改訂履歴

- 2026-05-28: 初版（DOC-1）。V-1〜V-6 / OBS-1 / OBS-2 / PASS-1 / RATE-1 で構築した deterministic optimization layer の運営知識を正本化。runtime 変更なし、documentation only。
- 2026-05-28: CAL-2（docs 統合）。COST-1 / CAL-1 を踏まえて運営導線を整理。§8 に `cost()` 用例 + AVG token calibration の cross-link block を追加、§9 current limitations の cost 項を rough heuristic 表現に更新、§10 future directions の cost 推計エントリを精緻化方針に書き換え、§11 関連ドキュメントに CAL-1 を追加。runtime / payload contract / window API / AVG 定数 すべて不変。
- 2026-05-29: OBS-3。route economics aggregation layer を追加。新規 [lib/devRouteEconomics.ts](../../lib/devRouteEconomics.ts) を 1 関数 + 1 型 + 1 私的 helper で導入し、window API に `getRouteEconomics()` を追加。§8 にコード例と「route economics layer の責務境界」inline block を追記、§9 current limitations に集計 view としての境界項を追加、§11 関連ドキュメントに新ファイルを追加。avoidance ≠ actual saved billing の境界を明文化。route.ts / validator / log payload / counter logic / AVG 定数 すべて不変、新しい runtime instrumentation ゼロ。
