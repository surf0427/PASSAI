# AI Score Contract（新規 route 追加時の予防ルール）

## 1. 目的

- AI に数値スコアを返させる route で、prompt 制約と JSON contract と UI/cache 表示の **三層に矛盾を生まない**ためのルール
- 過去 [`/api/statement-review` v3](../statement/) で実際に発生した「totalScore floor」と「合計一致ルール」の同時要求が、AI 出力の数値整合性を壊した事故を再発させない
- 既存 route（statement-review v4 / essay-review）は本ルールを満たしている。新規 route 追加・既存 route 改修時に本ガイドを参照する

実装の単一情報源としては既存ファイルが優先される（lib/statement/score/statementScore.ts の normalize / lib/essay/parseEssayReview.ts の server-side override 等）。本書は **規約レイヤ** のみ扱う。

---

## 2. 背景（過去の事故）

### 2.1 statement-review v3 で起きたこと

prompt 内に同時に存在した制約:

- 各項目（5 軸）は **8〜20** の整数
- totalScore は **60〜100** の整数（60 未満は出さない）
- totalScore は **各項目の合計と一致** させること

→ 各項目 min × 5 = 40 < totalScore min 60 となり、低品質エッセイで AI が各軸 8〜11 で採点したい場合、**3 つのルールのうち最低 1 つを破る以外に出力できない**。

### 2.2 AI の挙動

STEP4d 実測（3 件）: Claude は **`totalScore≥60` floor を最優先**、「合計と一致」を破棄。各軸合計 57/56/58 に対し totalScore 66/66/68 を返した。底上げ値が UI に伝染する寸前で、client side の `normalizeStatementScore()` が breakdown 合計で上書きしていたため辛うじて表示は無事だったが、prompt 内に整合性違反を強制する状態は token の浪費と AI 信頼度低下を招いていた。

### 2.3 数値で見る矛盾

```
各項目 min × 5  = 8 × 5  = 40     ← AI が出せる scores 最小合計
totalScore min          = 60       ← prompt が要求する totalScore 下限
合計一致ルール          = sum === totalScore
```

各軸合計が 40〜59 になる採点シナリオでは、3 つのうちどれかを必ず破る。AI はその「どれを破るか」を毎回選び、結果として cache 化された出力品質がばらつく。

### 2.4 修正（STEP5b）

- 「totalScore 60〜100」「合計と一致」の二重制約を撤廃
- 「totalScore は 5 項目の単純合計値そのまま入れる・サーバで再計算するため底上げ不要」を明記
- `STATEMENT_REVIEW_PROMPT_VERSION` 3 → 4 へ bump
- STEP5d で `totalScore === sum(scores)` が **3/3 で成立**することを実 AI で確認

---

## 3. 基本原則

1. **AI に数値合計を保証させない**。整合性を要求するなら server-side で再計算して上書きする
2. **prompt 制約は数学的に整合させる**。各項目 min × N と totalScore min を矛盾させない（max 側も同様）
3. **JSON contract は安易に変えない**。`totalScore` field 削除や score field 追加は UI / cache shape guard / 履歴データ互換すべてに波及する
4. **cache guard は原則 type guard のみ**。値域チェック（`>=60` 等）を入れると prompt 改修で値分布が変わった瞬間に過去 cache を弾く / 新 AI 出力を弾く事故になる
5. **UI 表示は server-side normalize 経路でだけ参照する**。AI の `totalScore` 生値を画面に直接バインドしない

---

## 4. 推奨パターン

### A. 項目 score を AI に返させ、totalScore は server-side で再計算する（最推奨）

- AI は **breakdown / scores 各軸のみ** に集中
- server / client の normalize 層で `total = sum(items)` を必ず再計算
- AI が万一不整合な totalScore を返しても表示には現れない
- 実例: `/api/statement-review` の [`normalizeStatementScore`](../../lib/statement/score/statementScore.ts)、`/api/essay-review` の [`safeParseResult`](../../lib/essay/parseEssayReview.ts) の `finalScore = breakdown.reduce(...)`

### B. totalScore field を contract 上残す場合の prompt 文言

JSON contract に `totalScore` field が残っているなら、prompt には次の 2 行を明記する:

- 「totalScore は各項目の単純合計値をそのまま入れる」
- 「totalScore はサーバ側で再計算されるため、最低値の底上げや帳尻合わせの調整は行わない」

→ AI の floor 優先挙動を抑え、出力 token も削減できる。

### C. PROMPT_VERSION bump が必要なケース

次のいずれかに該当したら必ず bump（既存 cache とレーン分離する）:

- SYSTEM_PROMPT 内のスコアルール文言を変えた（user prompt が byte-identical でも bump 必要）
- 各項目 score の範囲を変えた
- breakdown のラベル集合を変えた
- 出力 schema の数値範囲表記を変えた
- server-side normalize の式が変わった（同じ AI 出力でも保存値が変わるため）

履歴コメントは [`lib/aiInputHash.ts`](../../lib/aiInputHash.ts) 内既存スタイル（`vN → vN+1 : 改修内容` の 4〜6 行コメント）を踏襲する。

### 推奨パターンの選び方

- 数値が **採点ロジックの中核** であり、再計算で済むなら **A**（AI に totalScore を返させない・server で合算）
- 既存 contract に `totalScore` field がすでにあり、shape を維持したい・互換性を壊したくないなら **B**（field は残し、prompt 文言で「合計値そのまま」を明記）
- A / B どちらを選んでも **C の bump 条件** は同じく適用する

---

## 5. 禁止パターン

| ✗ | 内容 | なぜダメか |
|---|---|---|
| ✗ | 各項目 score min の合計 **より高い** totalScore floor を置く | 低スコア時に三者同時成立不能。AI が必ず 1 ルールを破る |
| ✗ | totalScore floor と「合計一致」を同時に要求する | 上記と同じ。statement-review v3 がこの罠を踏んだ |
| ✗ | AI の `totalScore` を UI 表示でそのまま信用する | AI 出力の数値分布が prompt 改修で動いた瞬間に UI が崩れる |
| ✗ | score field を後から削除する | cache shape guard / UI / 履歴データすべてに波及。互換性破壊 |
| ✗ | cache guard で値域を強く縛る（`score >= 60` 等） | prompt 改修で値分布が動いた瞬間に過去 cache 全 miss / 新出力全 reject |
| ✗ | score 軸数を変更する（5 → 6 等） | breakdown ラベル / UI evaluations / 履歴データ全てに波及 |
| ✗ | bump せずに SYSTEM_PROMPT のスコアルール文言を変える | v3 cache が v4 出力で汚染される |

---

## 6. 既存 route の現状（STEP6a 横断調査時点）

| route | AI 出力 score | 範囲整合 | server normalize | 状態 |
|---|---|---|---|---|
| `/api/statement-review` v4 | `totalScore` + `scores.5軸` | 各軸 8〜20、totalScore は合計値そのまま明記 | あり（[`normalizeStatementScore`](../../lib/statement/score/statementScore.ts)） | ✓ |
| `/api/essay-review` | `totalScore` + `breakdown[5]` | 各軸 0〜20 = sum 0〜100 = totalScore 0〜100 で完全整合 | あり（[`safeParseResult`](../../lib/essay/parseEssayReview.ts) の `finalScore = sum(breakdown)`） | ✓ |
| `/api/matching` | （AI は `reason` のみ） | n/a（deterministic layer が score 計算） | n/a | ✓ |
| `/api/interview-feedback` | `levelEvaluation: 'weak'|'normal'|'strong'` | カテゴリカル、数値スコアなし | n/a | ✓ |
| その他（analysis / summarize / additional / essay-chat / reason / analyze / interview-questions / statement-prepare） | 数値スコア出力なし | n/a | n/a | ✓ |

---

## 7. 受け側 normalize の最小形

server-side で `total` を再計算する場合の最小形（[`statementScore.ts`](../../lib/statement/score/statementScore.ts) から本質だけ抽出）:

```ts
const breakdown = {
  // 各軸 0〜MAX を clamp。NaN / 非数値は 0 に倒す
  axisA: clampItem(src.axisA),
  axisB: clampItem(src.axisB),
  // ...
};
const total = SCORE_KEYS.reduce((sum, k) => sum + breakdown[k], 0);
```

ポイント:

- AI が返した `totalScore` は **読まない**（fallback すら作らない）。合計の単一情報源を server に固定する
- `clampItem` は型違い・範囲外を明示的に倒す（防御的に 0 へ寄せる場合は rank 表示の閾値も確認）
- normalize は **route ごとに 1 ファイル**に集約。複数ページで同じ計算を散らさない

cache shape guard 側は値域に踏み込まない:

```ts
// OK: 型のみチェック
if (typeof v.totalScore !== 'number') return false;

// NG: 値域も縛る → prompt 改修で AI 出力分布が動いた瞬間に過去 cache 全 miss
if (typeof v.totalScore !== 'number' || v.totalScore < 60) return false;
```

---

## 8. 新規 route 追加時 checklist

新規に AI 数値スコアを返す route を作る・既存 route のスコア構造を変える前に、以下を順に確認する:

1. **score item 数** — 既存 5 軸踏襲か新規か。新規なら UI / cache guard / 履歴互換の影響を必ず洗う
2. **item min / max** — `0〜20` か `8〜20` か。min × N を必ず控えておく
3. **totalScore min / max** — min × N と totalScore min が一致するか。max も同様
4. **合計一致ルールの要否** — 入れるなら **必ず server-side 再計算もセットで実装**（4 → 推奨パターン A）
5. **server-side normalize の有無** — `total = sum(items)` 上書きを必ず通すか。通すなら prompt 上 floor / 帳尻合わせ禁止を明記（4 → 推奨パターン B）
6. **cache guard の値域チェック** — 原則 `typeof === 'number'` のみ。値域チェックを入れたいなら「AI 出力分布が変わる可能性があっても guard を更新できるか」を別途検討
7. **PROMPT_VERSION bump 要否** — スコアルール文言 / 範囲 / 軸数 / normalize 式のいずれかを変えたら必須（4 → 推奨パターン C）
8. **UI bind 経路** — UI が AI 生 `totalScore` を直接表示する経路がないか確認。あれば server normalize 経由に差し替え
9. **既存 score 表示 / 履歴の後方互換** — 過去保存データを normalize で読み替えられるか

---

## 9. 関連ドキュメント

- [`docs/principles/ai_cache_observability.md`](./ai_cache_observability.md) — cache hit/miss 観測仕様、PROMPT_VERSION 運用
- [`docs/principles/ai_usage_observability.md`](./ai_usage_observability.md) — token usage 観測仕様
- [`docs/principles/ai_policy.md`](./ai_policy.md) — AI 利用全般のポリシー
- [`docs/principles/architecture_rules.md`](./architecture_rules.md) — code 配置ルール（route / lib / contextBuilders の責務境界）
- [`docs/principles/incremental_refactor_policy.md`](./incremental_refactor_policy.md) — STEP 種別と PROMPT_VERSION bump の関係
- [`docs/statement/statement_score_system.md`](../statement/statement_score_system.md) — statement-review の正本実装と normalize 思想
- [`docs/statement/statement_current_state.md`](../statement/statement_current_state.md) — statement 機能の現状
- [`docs/statement/statement_steps.md`](../statement/statement_steps.md) — statement 機能の STEP 履歴
- [`lib/aiInputHash.ts`](../../lib/aiInputHash.ts) — PROMPT_VERSION の単一情報源
- [`lib/statement/score/statementScore.ts`](../../lib/statement/score/statementScore.ts) — score normalize の参考実装
- [`lib/essay/parseEssayReview.ts`](../../lib/essay/parseEssayReview.ts) — server-side override の参考実装
