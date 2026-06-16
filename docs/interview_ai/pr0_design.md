# Interview AI — PR0 設計ドキュメント（課金・冪等・スキーマ確定）

本書は面接 AI（リアルタイム面接セッション）機能の **PR0（基盤設計）** を確定するもの。
課金トリガ・二重課金防止・DB スキーマ・quota の確定仕様をまとめ、後続 PR の実装契約とする。

実装の単一情報源は既存ファイルが優先される（[lib/billing/planGate.ts](../../lib/billing/planGate.ts) /
[lib/billing/usageLog.ts](../../lib/billing/usageLog.ts) / [lib/billing/quotas.ts](../../lib/billing/quotas.ts) /
[types/interview.ts](../../types/interview.ts)）。本書は **規約・確定仕様レイヤ** を扱う。

関連原則: [ai_usage_observability](../principles/ai_usage_observability.md) /
[ai_score_contract](../principles/ai_score_contract.md) / [architecture_rules](../principles/architecture_rules.md)。

---

## 1. 目的とスコープ

### 1.1 目的

- 面接 AI セッション（voice / text）の **課金トリガを 1 セッション = 1 quota に確定** する。
- voice / text のどちらの経路でも quota 回避が成立しない冪等な課金設計を定める。
- 観測（`logAiUsage`）と課金（`recordUsage`）の責務を分離し、内部 AI 呼び出しが quota を二重・過剰消費しないことを保証する。
- 後続 PR が依存する DB スキーマ・RLS・quota テーブルの形を固定する。

### 1.2 既存 `interview` feature との区別（重要）

既存の quota feature `interview` は **面接フィードバック（`interview-feedback`）+ 質問生成（`interview-questions`）** を
集約済み（[quotas.ts](../../lib/billing/quotas.ts) の `FEATURE_ROUTE_KEYS.interview`）。これは「ユーザーが Q&A を入力し、
まとめてフィードバックを受ける」一括バッチ型の既存機能であり、**本機能とは別物**。

本機能（Interview AI）は **対話型・逐次ターンのリアルタイム面接** であり、課金単位（セッション）も
冪等化の仕組み（`usage_recorded` フラグ）も異なる。したがって **新規 quota feature として分離** する。

| | 既存 `interview` | 本機能 Interview AI |
|---|---|---|
| quota feature | `interview` | **`interview-ai`**（新規） |
| usage_records.route | `interview-feedback` / `interview-questions` | **`interview-ai`**（新規） |
| 課金単位 | route 呼び出し | **セッション**（1 セッション 1 回） |
| 冪等化 | なし（route ごと） | **`interview_ai_sessions.usage_recorded` の compare-and-set** |

### 1.3 命名規約（混同防止）

| レイヤ | 値 | 備考 |
|---|---|---|
| `QuotaFeature` literal | `'interview-ai'` | 既存 `'self-pr'` と同じハイフン規約に揃える |
| `usage_records.route` | `'interview-ai'` | `recordUsage({ route: 'interview-ai', ... })` |
| DB テーブル | `interview_ai_sessions` / `interview_ai_results` | snake_case（Postgres 規約） |

> 「interview_ai」は機能の通称。コード上の識別子は上表のとおり使い分ける。

---

## 2. 課金トリガ確定仕様

### 2.1 大原則

**voice / text のどちらでも、1 セッションにつき必ず 1 回だけ `interview-ai` quota を消費する。**

`recordUsage({ route: 'interview-ai', status: 'ok' })` を 1 セッションあたり **正確に 1 回** 呼ぶ。

### 2.2 voice 経路

`source = "voice"` の場合:

- **最初の STT 成功時** に `recordUsage('interview-ai', 'ok')` を 1 回実行する。

理由:

- STT コストがこの時点で実際に発生する。
- STT 後にユーザーが離脱しても原価漏れ（実行したのに未計上）を防げる。

> STT が **失敗** した場合は `recordUsage` を呼ばない。失敗で quota を消費させない既存方針
> （[planGate.ts](../../lib/billing/planGate.ts): COUNT は `status='ok'` のみ）と一致する。

### 2.3 text 経路

`source = "text"` の場合:

- **最初の回答保存時** に `recordUsage('interview-ai', 'ok')` を 1 回実行する。

理由:

- text 経路には STT イベントが存在しない。
- text 専用利用による quota 回避を防ぐため、回答保存の最初の確定点で計上する。

### 2.4 トリガ一覧（確定）

| source | 課金トリガ | status |
|---|---|---|
| `voice` | 最初の STT **成功** | `'ok'` |
| `text` | 最初の回答保存 | `'ok'` |

---

## 3. 二重課金防止（冪等化）

### 3.1 方式

voice / text 共通で、`interview_ai_sessions.usage_recorded`（boolean）を使い **compare-and-set 方式** で冪等化する。

```sql
UPDATE interview_ai_sessions
SET usage_recorded = true
WHERE id = :session_id
  AND usage_recorded = false
RETURNING id;
```

- この UPDATE で **行が返ったプロセスだけ** が `recordUsage` を呼ぶ。
- 行が返らなかった場合は **すでに課金済み** とみなし `recordUsage` を呼ばない。

### 3.2 なぜ compare-and-set か

- voice の STT 並列イベント / text の二重保存 / リトライ / 同時タブなど、トリガが複数回発火しうる。
- `SELECT → if false → UPDATE` だと TOCTOU レースで二重計上が起こる。
- 単一 UPDATE の述語 `usage_recorded = false` を原子境界にすることで、勝者プロセスを 1 つに確定する。
- このパターンは **アプリ層のロック不要** で、Postgres の行ロックに委ねられる。

### 3.3 quota 回避との接続（in_progress 制約との合わせ技）

`recordUsage` はセッション開始より**後**（最初の STT / 回答保存）に走るため、gate（§5.3）を通った直後〜
計上までの間に窓がある。この窓を悪用した「セッションを大量に開いて未計上のまま使い倒す」回避を、
**§7.3 の in_progress 1 ユーザー 1 件制約** が封じる（同時に複数セッションを開けない）。
gate（事前判定）+ in_progress 制約（同時実行制限）+ compare-and-set（事後の冪等計上）の 3 層で守る。

---

## 4. `recordUsage` 呼び出し箇所の制約（最重要）

`recordUsage` は **以下の 2 箇所以外で呼ばない**。

1. voice の最初の STT 成功時
2. text の最初の回答保存時

内部の AI 呼び出し:

- seed question generation（初期質問生成）
- followup question generation（深掘り質問生成）
- turn analysis（ターンごとの分析）
- final feedback（最終フィードバック生成）

では **`recordUsage` を呼ばない**。これらは **`logAiUsage` のみ**（観測）。

### 4.1 観測 vs 課金の責務分離

| 関数 | 用途 | 呼ぶ箇所 | テーブル |
|---|---|---|---|
| `logAiUsage` | 観測（token 実測） | **すべての AI 呼び出し**（seed / followup / turn analysis / final feedback / STT） | console log（`ai usage`） |
| `recordUsage` | 課金（quota 計上） | **§2 の 2 箇所のみ** | `usage_records`（status='ok'） |

> `logAiUsage` は token コスト観測のため全 AI 呼び出しで吐く（[ai_usage_observability](../principles/ai_usage_observability.md)）。
> `recordUsage` は quota の根拠になるため、1 セッション 1 回に厳密に絞る。**この 2 つを混同しないこと**が本機能の核。

### 4.2 アンチパターン（禁止）

- ❌ followup 生成のたびに `recordUsage` を呼ぶ（1 セッションが複数 quota を食う）。
- ❌ final feedback で `recordUsage` を呼ぶ（途中離脱したユーザーが計上漏れ、最後まで進んだユーザーだけ計上される不公平）。
- ❌ `logAiUsage` を STT / トリガ箇所で省略する（token 観測の穴）。

---

## 5. Quota 設計

### 5.1 上限テーブル（確定）

`interview-ai` feature を [quotas.ts](../../lib/billing/quotas.ts) に追加する。

| plan | interview-ai 月次上限 |
|---|---|
| free | **0** |
| basic | **10** |
| premium | **30** |

`QUOTA_FEATURES` に `'interview-ai'` を追加し、`QUOTAS` の各 plan に上記値を追加する。

### 5.2 FEATURE_ROUTE_KEYS

```
interview-ai: ['interview-ai']
```

1 feature = 1 route の 1:1 対応。gate の月次 COUNT は `usage_records.route = 'interview-ai'` かつ `status='ok'` を数える。
§3 の冪等化により 1 セッション = 1 ok record になるため、**月次 ok 件数 = 当月セッション数**。

### 5.3 gate の適用点

- セッション**作成時**（in_progress セッションを作る直前）に `ensurePlanQuota('interview-ai')` を判定する。
- gate が `reject`（402 quota-exceeded / 401 unauthenticated）ならセッションを作らせない。
- gate が `ok` ならセッションを `in_progress` で作成する。
- 実 quota の計上（`recordUsage`）は §2 のトリガまで遅延する（gate の COUNT には作成時点ではまだ載らない）。

> gate は「事前判定」、recordUsage は「事後計上」。両者の間の窓は §3.3 の in_progress 制約で守る。

### 5.4 quota UI

[app/mypage/UsageStatusCard.tsx](../../app/mypage/UsageStatusCard.tsx) の `FEATURE_LABELS` に `interview-ai` を追加し、
「今月の利用状況」に **interview_ai を表示** する。

```
'interview-ai': '面接AI',
```

`UsageStatusCard` は `QUOTA_FEATURES` を flatMap して描画するため、quotas.ts に feature を足せば自動的に行が増える。
ラベルだけ追加すればよい（limit=0 の free は既存ロジックで非表示）。料金ページ表記も同時更新する
（[quotas.ts](../../lib/billing/quotas.ts) のコメント規約: 上限改定時は料金ページと両方更新）。

---

## 6. DB スキーマ

### 6.1 `interview_ai_sessions`

セッションの状態・課金冪等フラグ・対象参照を持つ。

| column | type | 備考 |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid NOT NULL | `auth.users(id)` ON DELETE CASCADE。owner key |
| `source` | text NOT NULL | CHECK in (`'voice'`, `'text'`) |
| `status` | text NOT NULL | CHECK in (`'in_progress'`, `'completed'`, `'abandoned'`)。§7.3 参照 |
| `usage_recorded` | boolean NOT NULL DEFAULT false | §3 の compare-and-set 対象 |
| `target_ref` | jsonb NOT NULL | §6.3。**version を持たせる** |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | `set_updated_at()` trigger |

**部分ユニーク制約（in_progress を 1 ユーザー 1 件に制限）:**

```sql
CREATE UNIQUE INDEX interview_ai_sessions_one_in_progress
  ON interview_ai_sessions (user_id)
  WHERE status = 'in_progress';
```

### 6.2 `interview_ai_results`

セッション完了時の最終フィードバックを保存する（音声は保存しない / §7.1）。

| column | type | 備考 |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | uuid NOT NULL | `interview_ai_sessions(id)` ON DELETE CASCADE |
| `user_id` | uuid NOT NULL | owner key を複製（JOIN なし RLS 用、tutor_chat_messages と同パターン） |
| `feedback` | jsonb NOT NULL | 既存 `InterviewFeedback` 形（§8） |
| `strengths` | text[] NOT NULL DEFAULT '{}' | **追加**。強み（文字列箇条書き） |
| `improvements` | text[] NOT NULL DEFAULT '{}' | **追加**。改善点 |
| `next_practice` | text[] NOT NULL DEFAULT '{}' | **追加**。次の練習 |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

> `strengths` / `improvements` / `next_practice` を `interview_ai_results` に追加するのは確定事項。
> 既存 `InterviewFeedback` は `goodPoints` / `improvements` / `nextPractice` を持つが、Interview AI の
> 結果サマリとして**独立カラム**に正規化し、履歴一覧・成長メモから JOIN なしで読めるようにする。

### 6.3 `target_ref`（version 付き）

面接対象（大学 / 学部 / 想定質問セット等）の参照を `target_ref` jsonb に持たせ、**version を含める**。

```jsonc
{
  "version": 1,
  "universityId": "...",
  "faculty": "...",
  "examType": "..."
  // 必要に応じ拡張
}
```

理由:

- 対象スキーマ（質問セットの構成・大学コンテキストの形）は今後変わりうる。
- `version` を持たせることで、過去セッションの `target_ref` を後方互換に読める（migration なしで古い形を識別）。
- [ai_score_contract](../principles/ai_score_contract.md) の「JSON contract は安易に変えない / 互換性に波及」方針に沿う。

### 6.4 RLS（EXISTS 方式・確定）

全テーブル `ENABLE ROW LEVEL SECURITY`。対象 role は `authenticated`（Anonymous Auth も role=authenticated で届く）。

- `interview_ai_sessions`: owner key 直接判定。
  ```sql
  USING (auth.uid() = user_id)        -- SELECT
  WITH CHECK (auth.uid() = user_id)   -- INSERT / UPDATE
  ```
- `interview_ai_results`: **EXISTS 方式** で親セッションの所有を判定する（確定）。
  ```sql
  CREATE POLICY "interview_ai_results owner select"
    ON interview_ai_results FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM interview_ai_sessions s
        WHERE s.id = interview_ai_results.session_id
          AND s.user_id = auth.uid()
      )
    );
  -- INSERT / UPDATE / DELETE も同じ EXISTS 述語
  ```

> `user_id` を複製しているので `auth.uid() = user_id` だけでも閉じるが、**親セッションの所有と結果の所有が
> 必ず一致すること** を RLS で保証するため EXISTS 方式を採る（孤児・付け替えを構造的に排除）。
> 書き込み（service_role 経由の final feedback 保存）は RLS を通らないが、ユーザー読み取りは EXISTS で閉じる。

---

## 7. その他の確定事項

### 7.1 音声保存なし

- STT の入力音声・音声バイナリは **保存しない**。
- 保存対象は text（質問 / 回答 / フィードバック JSON）のみ。
- [ai_usage_observability](../principles/ai_usage_observability.md) の「ユーザー入力本文をログに出さない」方針とも整合（音声は最も機微）。

### 7.2 MVP では text fallback を残す

- voice（STT）が使えない環境・失敗時のために、MVP では **text fallback** 経路を残す。
- text fallback でも §2.3 のトリガ（最初の回答保存）で 1 回計上され、quota 回避にならない。

### 7.3 in_progress は user ごとに 1 件まで

- 1 ユーザーが同時に持てる `status='in_progress'` セッションは **1 件**（§6.1 の部分ユニークインデックスで強制）。
- 新規セッション作成時に既存 in_progress があれば「続きから」へ誘導するか、明示的に `abandoned` にしてから作る。
- §3.3 のとおり、これが deferred recordUsage の quota 回避を封じる要。

### 7.4 既存 `InterviewFeedback` / `LevelEvaluation` を再利用

- [types/interview.ts](../../types/interview.ts) の `InterviewFeedback` / `LevelEvaluation` を **そのまま再利用** する（新型を作らない）。
- final feedback の JSON contract は既存形に揃え、`feedbackToText` / `isInterviewFeedback`（type guard）/
  `normalizeInterviewFeedback` 等の既存ユーティリティを流用できるようにする。
- §6.2 の `strengths` / `improvements` / `next_practice` は **結果テーブル上の正規化カラム**であり、
  `InterviewFeedback` 型そのものは変更しない（contract 安定を維持）。

---

## 8. 後続 PR の見通し（PR0 のスコープ外）

PR0 は **本設計の確定** までをスコープとする。以下は後続。

| PR | 内容 |
|---|---|
| PR0 | 本設計ドキュメント（確定） |
| 次 | `quotas.ts` への `interview-ai` 追加 + `UsageStatusCard` ラベル + 料金ページ表記 |
| 次 | `interview_ai_sessions` / `interview_ai_results` スキーマ + RLS（EXISTS）migration |
| 次 | セッション作成 route（gate `ensurePlanQuota('interview-ai')` + in_progress 制約） |
| 次 | voice 経路（STT 成功トリガ + compare-and-set recordUsage） |
| 次 | text 経路（回答保存トリガ + compare-and-set recordUsage） |
| 次 | seed / followup / turn analysis / final feedback の `logAiUsage` 実装（recordUsage は呼ばない） |

各 PR は本書の確定仕様を契約として参照する。仕様変更が必要になった場合は **本書を先に更新** してから実装に入る。

---

## 9. 確定事項チェックリスト

- [x] 課金トリガ: voice = 最初の STT 成功 / text = 最初の回答保存（各 1 回）
- [x] 二重課金防止: `usage_recorded` の compare-and-set（UPDATE … WHERE usage_recorded=false RETURNING）
- [x] `recordUsage` は §2 の 2 箇所のみ。内部 AI 呼び出しは `logAiUsage` のみ
- [x] RLS は EXISTS 方式
- [x] quota UI に interview_ai を表示
- [x] `interview_ai_results` に strengths / improvements / next_practice を追加
- [x] `target_ref` に version を持たせる
- [x] quota: free 0 / basic 10 / premium 30
- [x] in_progress は user ごと 1 件まで
- [x] 音声保存なし
- [x] MVP では text fallback を残す
- [x] 既存 `InterviewFeedback` / `LevelEvaluation` を再利用
