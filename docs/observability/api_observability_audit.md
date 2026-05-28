# API Observability Audit（軽量化フェーズ実効性監査）

## 1. 目的

API 軽量化フェーズ（STEP-API-MEASURE-01 / CACHE-01 / CACHE-02 / CACHE-NOTE-01 / TIMEOUT-01 / OBSERVABILITY-01 / MATCHING-01）の **本番実効性を観測ベースで監査** する。次の最適化判断（例えば interview-feedback の admissionFocusContext 圧縮や Opus → Sonnet downgrade）を、推測ではなく実測値で行うための土台。

本ドキュメントは **観測整理のみ**。runtime code / prompt / cache_control / timeout / PROMPT_VERSION / hash / UI には一切変更を加えない。

関連:
- 観測項目の正本: [`docs/principles/ai_usage_observability.md`](../principles/ai_usage_observability.md)
- cache hit / miss レーン: [`docs/principles/ai_cache_observability.md`](../principles/ai_cache_observability.md)
- 実装: [`lib/aiUsageLog.ts`](../../lib/aiUsageLog.ts) / [`lib/aiCacheLog.ts`](../../lib/aiCacheLog.ts)

---

## 2. 現在 logAiUsage で記録されている項目

実装は [`lib/aiUsageLog.ts`](../../lib/aiUsageLog.ts) の `logAiUsage()` 1 本。`console.info('ai usage', payload)` 形式。

| field | type | 意味 |
|---|---|---|
| `route` | `string` | AI route 識別子（例: `'api/analysis'`、`'api/matching'`） |
| `model` | `string` | 使用 model（例: `'claude-sonnet-4-6'`、`'claude-opus-4-7'`） |
| `status` | `'success' \| 'truncated' \| 'parse_failed' \| 'failed'` | 4 値 |
| `input_tokens` | `number \| null` | 入力 token。response が無い経路では `null` |
| `output_tokens` | `number \| null` | 出力 token。同上 |
| `total_tokens` | `number \| null` | `input_tokens + output_tokens` |
| `cache_creation_input_tokens` | `number \| null` | **STEP-API-OBSERVABILITY-01 で追加**。当該 request で cache を新規作成した入力 token |
| `cache_read_input_tokens` | `number \| null` | **同上**。当該 request が cache hit して読み出した入力 token |

duration_ms / request_id は現状未記録（platform 側 access log で取得する設計）。

別レーン [`lib/aiCacheLog.ts`](../../lib/aiCacheLog.ts) の `logAiCache()` で `route / action ('hit' | 'miss') / inputHash` を出力（client-side input hash cache の hit/miss 観測。Anthropic prompt cache とは別レイヤー）。

---

## 3. cache hit 判定（Anthropic prompt caching）

`logAiUsage` の cache token フィールドだけで以下の状態を区別する。`status === 'failed'` 経路は usage が無く判定対象外。

| パターン | 条件 | 意味 |
|---|---|---|
| **cache hit** | `cache_read_input_tokens > 0` | system prompt を Anthropic 側 cache から読み出し、input 単価が割引された |
| **cache cold creation** | `cache_creation_input_tokens > 0` かつ `cache_read_input_tokens === 0` | 当該 request が cache を新規作成。次回 5 分以内の同 system prompt 呼び出しで読み出し可能になる |
| **cache 配備済だが threshold 未達** | 両方 `0` または `null` | cache_control を渡したが system token が 1,024 未満で Anthropic 側で silently skip された（Sonnet 4-6 の閾値） |
| **cache 未配備** | 両方 `null`（フィールド自体が記録されない経路は無いが、route が cache_control を持たない場合） | 本フェーズ後は essay-chat のみ |

cache_read / cache_creation の合算が `input_tokens` に含まれる（Anthropic SDK の `Usage` 仕様）ため、cache hit 時の **「読み出し token は input_tokens の内訳」** として扱う。

別系統の client-side input hash cache（[`logAiCache`](../../lib/aiCacheLog.ts) 経路）は AI を呼ぶ前に skip する仕組みで、Anthropic prompt caching とは別レイヤー。

---

## 4. 観測すべき KPI（今後 1〜2 週間）

### 4.1 route 横断

| KPI | 計算 | 目標 / 異常値 |
|---|---|---|
| 全 route の status 内訳 | `count(status) / total` | `success` >= 95%、`failed` < 5%、`parse_failed` < 1%、`truncated` < 1% |
| 全 route の平均 input tokens | `sum(input_tokens) / count` | 急増（前週比 +20%）を警戒 |
| 全 route の平均 output tokens | 同上 | 急増（前週比 +20%）を警戒 |
| timeout 発生頻度 | `failed` のうち AbortError 由来のもの | route × 日次で集計、< 1% 想定 |

### 4.2 prompt caching の実効性

| KPI | 計算 | 目標 / 異常値 |
|---|---|---|
| route ごとの cache hit rate | `count(cache_read_input_tokens > 0) / count(success)` | A 級 route（statement-review / analysis / interview-feedback / essay-review / essay-improve-summary / tutor / matching / interview-questions）で **>= 20%** を期待。0 継続なら配備失敗の可能性 |
| route ごとの cache creation rate | `count(cache_creation_input_tokens > 0) / count(success)` | 各 cache lane の最初の 1 リクエストでのみ発生。連続呼び出しが多い route ほど 0 に近い |
| cache_read / total input tokens の比 | `cache_read_input_tokens / input_tokens` | system prompt が長い route ほど高い（statement-review / analysis で 30〜50% を想定） |
| B 級 route（summarize / additional）の cache hit | `cache_read_input_tokens > 0` の発生有無 | 1 回でも観測されれば配備の意味あり。継続 0 なら閾値未達と判明 |

### 4.3 route 個別の Opus / 並列固有

| KPI | route | 計算 | 目標 / 異常値 |
|---|---|---|---|
| Opus token 比率 | `interview-feedback` | `sum(total_tokens)` の route 別シェア | Opus のため単価高。コスト全体の 20〜40% を占める可能性 |
| matching partial fail 率 | `matching` | per-request の `failedCandidates > 0` の割合 | < 5% が望ましい。継続増加なら根本対策が必要 |
| interview-questions retry 率 | `interview-questions` | 同一 request 内で 2 回 logAiUsage が発火する割合 | < 10% が想定（validate fail 時のみ） |
| matching all-fail 率 | `matching` | 500 response の発生率 | ほぼ 0% が望ましい。partial fail 化で大幅減を期待 |

---

## 5. route ごとの期待観測

### 🟢 cache hit が多発するべき route

| route | 期待 | 根拠 |
|---|---|---|
| `statement-review` | 同一受験生の 5 分以内「再添削」で連続 hit。`cache_read > 0` が 30〜60% | system ~1,800 tokens、UX 上「再添削」を繰り返す flow（STEP-API-MEASURE-01 / CACHE-01） |
| `analysis` | 同一活動データでの再分析・再生成で hit。`cache_read > 0` が 20〜40% | system ~2,000 tokens、再実行頻度は statement-review より低い |
| `interview-feedback` | Opus + system ~4,200 chars（推定 ~1,200 tokens）+ admissionFocusContext。同一 session 内の連続フィードバックで hit | Opus 単価が高いため cache hit の絶対効果が最大 |
| `essay-review` | 5 分以内の再添削で hit | system ~3,500 chars（既存配備済） |
| `essay-improve-summary` | 同一 works での再生成で hit | system ~1,300 chars + cache_control 配備済 |
| `interview-questions` | 日次バリエーション seed のため同日内の連続呼び出しで hit | dailySeed 仕様、cache_control 配備済 |
| `tutor` | 1 user の連続会話で hit。ただし plain text 応答のため client-side hash cache とは無関係 | system ~6,000 chars（lib/tutor/tutorPrompt.ts は 808 行）。Sonnet 4-6 で確実に閾値超え |
| `matching` | 5 並列内では system 共通 → 同一 request 内 4/5 件は hit | per-request の cache 共有が設計の主目的 |

### 🟡 cache hit が低くても許容な route

| route | 期待 | 根拠 |
|---|---|---|
| `summarize` (light / deep) | hit すれば得、しなくても fine | system ~2,600 chars、境界 token 数 |
| `analysis/additional` | 同上 | system ~2,200 chars、境界 token 数 |

### ⚪ cache 配備対象外 route

| route | 状態 |
|---|---|
| `essay-chat` | system ~1,729 chars / ~865 tokens で Sonnet 4-6 閾値未達と STEP-API-MEASURE-01 で確認。配備見送り。`cache_read > 0` は観測されない想定 |
| `statement-prepare`, `analyze`, `reason` | cache_control 未配備（system が小さい）。`cache_read` は常に `null` または `0` |

---

## 6. 異常値の定義

以下が観測されたら本フェーズの施策に問題があるか、または別 STEP の必要性が示唆される。

### 6.1 配備に関する異常

| 観測 | 解釈 | 対応 |
|---|---|---|
| A 級 route（statement-review / analysis / interview-feedback など）で `cache_read_input_tokens` がゼロ継続（1 週間以上） | cache_control が機能していない可能性 / 連続呼び出し UX が想定と異なる | system 再計測、UX フローの実態確認 |
| `cache_creation_input_tokens` のみ発生し続け、`cache_read` がゼロ | 5 分以内の連続呼び出しが起きていない（user 行動が単発呼び出し） | UX 観点で問題なし。期待値の調整 |
| B 級 route で `cache_read` が継続 0 | 閾値未達。配備しても効果なし | 配備不要と判断（差し戻し or 文書化のみ） |

### 6.2 status に関する異常

| 観測 | 解釈 | 対応 |
|---|---|---|
| `failed` 率 > 10% | timeout 多発 / API 障害 / network 問題 | route ごとに切り分け、timeout 値見直し |
| `parse_failed` 率 > 2% かつ前週比増加 | AI 出力が schema を逸脱しやすくなった（model 挙動変化 / prompt drift） | prompt の出力ルール強化 or PROMPT_VERSION bump |
| `truncated` 率 > 5% | max_tokens 不足、または prompt が出力を膨らませている | max_tokens 引き上げ or prompt 整理 |
| 特定 route の `success` でも `output_tokens` が異常増（前週比 +30%） | AI が冗長化、または prompt 変更の副作用 | prompt diff 確認 |

### 6.3 matching 固有

| 観測 | 解釈 | 対応 |
|---|---|---|
| `failedCandidates > 0` を含む partial response 率 > 10% | 5 並列の堅牢性が不足。1 大学の AI 失敗が散発 | per-candidate retry の検討、または timeout 値見直し |
| matching の 500 response 率 > 1% | 全 candidate fail の頻発 | network / API 全体障害の可能性。STEP-API-MATCHING-01 の partial-fail 化で本来は 0 に近いはず |

### 6.4 Opus 固有

| 観測 | 解釈 | 対応 |
|---|---|---|
| `interview-feedback` の `total_tokens` 平均が前週比 +20% | admissionFocusContext / studentProfile の冗長化、または質問数増加 | STEP-API-INTERVIEW-01（admissionFocusContext 圧縮）の優先度上昇 |
| `interview-feedback` の cache hit rate が < 10% | Opus の効果がほぼ得られていない | UX フロー再点検、または system prompt 構造の見直し |

---

## 7. 次の最適化判断基準

本ドキュメントの観測を 1〜2 週間継続し、次の STEP に進む判断材料を以下で固定する:

### 7.1 「効果あり → そのまま」

- A 級 route の `cache_read` 比率が `input_tokens` の 20% 以上 → prompt caching は機能している
- matching partial fail 率 < 5% → `Promise.allSettled` 化は機能している
- timeout 発生 < 1% → 60s default は妥当

→ 軽量化フェーズは安定運用フェーズへ移行。

### 7.2 「Opus 圧縮を発火」(STEP-API-INTERVIEW-01)

以下のいずれかが観測されたら interview-feedback の admissionFocusContext 圧縮を発火条件とする:

- interview-feedback の `total_tokens` 平均 > 6,000
- interview-feedback の Opus シェアが全 token コストの 30% 以上
- interview-feedback の cache hit rate < 20%

PROMPT_VERSION bump が伴うため、観測なしで先行実装はしない。

### 7.3 「Opus → Sonnet downgrade を発火」

- interview-feedback の `parse_failed` 率 < 1% かつ Opus 単価が問題視されるレベル → Sonnet 評価
- ただし dry-run QA（`scripts/step15-qa.ts` の interview-feedback ケース）で品質差を確認必須
- PROMPT_VERSION bump 必須

### 7.4 「cache 配備見直し」

- B 級 route（summarize / additional）で `cache_read` が 1 週間 0 → 配備の effectiveness が 0 と判明 → 維持 OR コメントで「効果なし」と記録（runtime 変更は不要、`type: 'ephemeral'` のままで害なし）

---

## 8. 観測項目の不変条件

本ドキュメントは以下を **絶対に変更しない**:

- `logAiUsage` の field 名・型（`route / model / status / input_tokens / output_tokens / total_tokens / cache_creation_input_tokens / cache_read_input_tokens`）
- `AiUsageStatus` の 4 値（`success / truncated / parse_failed / failed`）
- `logAiCache` の field 名・型（`route / action / inputHash`）
- PROMPT_VERSION 値（8 個すべて）
- cache identity / hash 関数
- system prompt 文字列・cache_control 配備位置
- timeout signal 配備位置

これらが変わるとログの後方互換性が壊れ、本ドキュメントの集計仕様が成立しなくなる。

---

## 9. 関連 doc

- [`docs/principles/ai_usage_observability.md`](../principles/ai_usage_observability.md) — `logAiUsage` の正本契約
- [`docs/principles/ai_cache_observability.md`](../principles/ai_cache_observability.md) — `logAiCache` の正本契約（client-side input hash cache）
- [`docs/principles/ai_score_contract.md`](../principles/ai_score_contract.md) — AI スコア契約（drift 監視）
- [`docs/observability/persona_drift_observability.md`](./persona_drift_observability.md) — 人格 drift 観測
- [`lib/aiUsageLog.ts`](../../lib/aiUsageLog.ts) / [`lib/aiCacheLog.ts`](../../lib/aiCacheLog.ts) — 実装
