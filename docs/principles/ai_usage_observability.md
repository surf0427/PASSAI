# AI Usage Observability（運用ガイド）

## 1. 目的

- 全 AI route の token 使用量を **実測** する（推測でコスト削減判断をしない）
- production log をもとに次の改善 STEP の優先順位を決める
- prompt 改修・max_tokens 引き下げ・prompt caching・API 分割の効果検証に使う
- dead code 判定（ある期間 log が 0 件なら削除候補）の根拠にする

実装は `lib/aiUsageLog.ts` の `logAiUsage()` 関数 1 本に集約されており、全 AI route が同形 payload を吐く。詳細は STEP4.4〜4.10 で構築。

---

## 2. ログ仕様

### 2.1 log key

```
ai usage
```

`console.info('ai usage', payload)` の第 1 引数として固定。platform 側の構造化 log 収集（Vercel / Datadog 等）でこの key をフィルタすれば AI usage line だけを抽出できる。

### 2.2 payload shape

| key | type | 意味 |
|---|---|---|
| `route` | `string` | AI route 識別子（例: `'api/analysis'`） |
| `model` | `string` | 使用 model（例: `'claude-sonnet-4-6'`） |
| `status` | `'success' \| 'truncated' \| 'parse_failed' \| 'failed'` | 経路区別 |
| `input_tokens` | `number \| null` | 入力 token 数。response が無い経路では `null` |
| `output_tokens` | `number \| null` | 出力 token 数。response が無い経路では `null` |
| `total_tokens` | `number \| null` | `input_tokens + output_tokens`。response が無い経路では `null` |

`usage` が undefined（messages.create が throw した経路）の場合、token 系 3 つはすべて `null`。

---

## 3. status の意味

| status | 発火条件 | usage |
|---|---|---|
| `success` | レスポンスが正常に組み立てられて返る直前 | 有 |
| `truncated` | `stop_reason === 'max_tokens'` を検出した経路 | 有 |
| `parse_failed` | AI 出力が期待 schema（JSON / 期待形）に parse できなかった経路 | 有 |
| `failed` | `messages.create()` が throw（network / API error / rate limit 等） | 無（null） |

### 集計時の解釈

- **`success`** が圧倒的多数であるべき
- **`truncated`** は prompt の output 量・max_tokens 設計の問題シグナル
- **`parse_failed`** は AI が schema を守らなかったシグナル（prompt の output 形式指示が弱い）
- **`failed`** は外部 API 要因が主。Anthropic API の rate limit / network エラー等

---

## 4. ログに出してはいけないもの

`LogAiUsageOptions` の型 `{ route, model, status, usage? }` でガードされているため、以下は **型として渡すことが不可能**:

- request body
- ユーザー入力（活動内容 / 自己PR / 志望理由書 / 小論文 / 面接回答 等の本文）
- prompt 本文（system / user メッセージのテキスト）
- AI 出力本文（raw text / parsed JSON / response body）
- 基本情報（`basicInfo` / 氏名 / 志望大学 / 学部 / 学科 等）
- 自己分析データ（`WallHittingResult` / `StudentProfile` 等）
- request 識別子（user-agent / IP / cookie / session）
- entity identifier（`universityId` / record ID 等）

ログ payload は **静的識別子 + 整数のみ** で構成する。

> 既存の `console.error('... truncated', { ..., rawTextTail })` 系の debug ログは STEP4.x のスコープ外として残置。`rawTextTail` は AI 出力末尾 200 char で、運用上は別 stream として扱う想定。

---

## 5. 実装済み route 一覧（全 11 route）

| # | route | model | log 経路数 | 備考 |
|---|---|---|---|---|
| 1 | `api/analysis` | `claude-sonnet-4-6` | 4 | 自己分析フローの本体 |
| 2 | `api/analysis/additional` | `claude-sonnet-4-6` | 4 | 自己分析の追加質問生成 |
| 3 | `api/summarize` | `claude-sonnet-4-6` | 4 | 自己分析フローの締めくくり |
| 4 | `api/statement-review` | `claude-sonnet-4-6` | 4 | 志望理由書添削 |
| 5 | `api/essay-review` | `claude-sonnet-4-6` | 4 | 小論文添削 |
| 6 | `api/interview-feedback` | `claude-opus-4-7` | 4 | 面接フィードバック（**唯一の Opus**） |
| 7 | `api/essay-chat` | `claude-sonnet-4-6` | 3 | 小論文チャット（plain text） |
| 8 | `api/matching` | `claude-sonnet-4-6` | 4 | 大学マッチング（**per-univ 5 calls**） |
| 9 | `api/reason` | `claude-sonnet-4-6` | 3 | 自己PR添削（plain text） |
| 10 | `api/analyze` | `claude-sonnet-4-6` | 4 | **dead code 疑い** |
| 11 | `api/statement-prepare` | `claude-sonnet-4-6` | 4 | 志望理由書整理メモ（rate limit あり） |

全 route で共通の `logAiUsage` 関数を import し、`MODEL` / `ROUTE` 定数を route ファイル内で定義している。

---

## 6. 特殊ケース

### 6.1 `api/matching` — 1 request = 5 log lines

候補 5 大学それぞれに `generateUniversityDetail()` で `anthropic.messages.create()` を呼ぶため、1 request あたり **最大 5 log line** が出る。

**集計時の注意:**
- 「per AI call」と「per user request」を区別する場合は別途集計ロジックが必要
- 単純に `route='api/matching'` を count すると user request 数の 5 倍になる
- `Promise.all` で並列実行されるため、log の順序は保証されない
- 一部失敗した場合: 成功した分は `success` log、失敗した分は `truncated` / `parse_failed` / `failed` log で記録される（per-call の self-report semantics）

### 6.2 `api/essay-chat` / `api/reason` — plain text route

AI 応答が plain text（JSON ではない）のため、構造上 **`parse_failed` は通常発生しない**。

実際に出る status:
- `success`
- `truncated`（plain text route も `stop_reason === 'max_tokens'` から検出して log する）
- `failed`

`parse_failed` の値は型として共有しているが、これら 2 route では出現しない。

### 6.3 `api/essay-review` — parse_failed でも 200 を返す

parse 失敗時も `safeParseResult({})` で fallback 値を埋めて **200 OK + fallback content** を返す既存挙動。ただし log では `parse_failed` として記録される。

**集計時の注意:**
- HTTP 200 と log status は一致しない（200 のうち一部は実は parse 失敗）
- 実 UX 品質を見るには log status を真として扱う
- 他 route は HTTP status と log status がほぼ一致

### 6.4 `api/analyze` — dead code 疑い

STEP4.10 時点の grep 検索ではクライアント側 `fetch()` の呼び出し元が見つからず、`/api/analysis` に置き換えられた旧経路の可能性が高い。

**判定基準（推奨）:**
- production deploy 後 **30 日間** observation
- その期間に `route='api/analyze'` の log が **0 件** なら削除候補
- 何件か出ている場合は、どこから呼ばれているか追加調査（CRON / 内部ツール / 古いクライアント等）

---

## 7. 推奨集計

### 7.1 route 別の token distribution

各 route について以下を出す:

| 指標 | 用途 |
|---|---|
| `input_tokens` の p50 / p90 / p99 / max | input 側コスト把握 / caching 判断 |
| `output_tokens` の p50 / p90 / p99 / max | output 側コスト把握 / max_tokens 設計検証 |
| `total_tokens` の p50 / p90 / p99 / max | 総コスト把握 |

### 7.2 route × status のクロス集計

| route | success | truncated | parse_failed | failed |
|---|---|---|---|---|
| api/analysis | ... | ... | ... | ... |
| api/analysis/additional | ... | ... | ... | ... |
| ...（11 route 全部）... | | | | |

そこから:

- **truncation rate** = truncated / (success + truncated + parse_failed)
- **parse_failed rate** = parse_failed / (success + truncated + parse_failed)
- **failed rate** = failed / 全件
  - ※ failed は外部 API 要因が混ざるため他 status と切り分けて見る

### 7.3 model 別 token 使用量

- `claude-sonnet-4-6`: 10 route
- `claude-opus-4-7`: 1 route（api/interview-feedback）

Opus は単価が高いため、Opus route の output_tokens × 単価が全体コストに占める比率を別途確認する。

### 7.4 フロー単位の集計（自己分析フロー）

1 user セッションあたりのコスト概算:

```
self-analysis flow total = api/analysis + N × api/analysis/additional + api/summarize
```

`N` は user が「もう少し質問」を押した回数（0〜数回）。

ユーザーごとの session id があれば結合できるが、本ログには user 識別子を含めないため、**時系列でグループ化** または **同 IP / session** ベースの集計は platform 側に委ねる（log 内で結合しない方針）。

---

## 8. SLI 候補

| SLI | 閾値 | 意味 |
|---|---|---|
| truncation rate | < 1% | output 量が max_tokens を超えた割合。超えれば prompt 改修 or max_tokens 引き上げ |
| parse_failed rate | < 0.1% | AI が schema を守らなかった割合。超えれば prompt の出力形式指示を強化 |
| failed rate | 外部 API 要因と分離して評価 | Anthropic 側の rate limit / network エラー等が混ざる |
| p99 output_tokens / max_tokens | < 0.85 | 設定 max_tokens の余裕度。0.85 を下回るなら max_tokens 引き下げ候補 |

各 route ごとに上記を計測する。

---

## 9. 次の改善判断（観測結果からの導線）

| 観測パターン | 推奨アクション |
|---|---|
| p99 output_tokens が max_tokens × 0.5 を下回る | **max_tokens 引き下げ** — レイテンシと挙動安定性が改善 |
| input_tokens が大きく（~2,048+）繰り返し呼ばれる | **prompt caching 導入** — 5 分以内の連続呼び出しで input 単価 ~90% 割引 |
| output_tokens の p99 が大きい | **prompt / schema 短縮** — STEP4.1〜4.3 のパターン（個数固定・字数上限）を他 route に適用 |
| call count が多い + 入力が安定 | **sourceHash skip / caching / API 分離** — 同入力なら AI を呼ばない構造に。`api/analysis` の profile / questions 分離が候補 |
| truncation rate > 1% | **prompt 出力量制約強化 or max_tokens 引き上げ** — どちらが UX を壊さないかで判断 |
| parse_failed rate > 0.1% | **prompt 出力形式指示の強化** — JSON strict 規律の文言追加 |
| 特定 route の log が 0 件（30 日以上） | **dead code 削除候補** — `api/analyze` が筆頭 |

具体的な数値判断は **観測フェーズ（最低 1〜2 週間）** の実測値を見てから決める。観測前に推測で動かない。

---

## 10. 関連実装

- 共通関数: `lib/aiUsageLog.ts`
- 型定義: `LogAiUsageOptions` / `AiUsageStatus` / `AiUsageTokens`
- 全 route の挿入箇所: STEP4.4〜4.10 の各 PR 履歴を参照
- 数値スコアを返す route の contract 規約: [ai_score_contract.md](./ai_score_contract.md)

prompt 改修側の歴史:
- STEP4.1〜4.3: `api/analysis` の output 安定化（questions / strengths / weaknesses / futureConnections / summary を個数固定・字数上限化）
- 同 STEP の詳細は `lib/prompts.ts` の `ANALYSIS_SYSTEM_PROMPT` および各 STEP 報告を参照

---

## 11. 改訂履歴

- 2026-05-11: 初版作成（STEP4.11）。STEP4.4〜4.10 で構築した全 11 route の usage logging 仕様を明文化。
