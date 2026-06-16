# Interview AI — PR3 スキーマ（interview_ai_sessions / interview_ai_results）

PR0 設計（[pr0_design.md](./pr0_design.md) §6）で確定した Interview AI の DB スキーマを
`supabase/schema.sql` §56–§60 に実装した記録 + operator 適用 runbook。

> 本 PR は **schema + RLS のみ**。quota feature key（`interview-ai`）追加・repository・
> route・課金配線（recordUsage / compare-and-set）・STT は後続 PR。

設計正本: [pr0_design.md](./pr0_design.md)。前例: [../supabase/statement_review_history_post_apply_checklist.md](../supabase/statement_review_history_post_apply_checklist.md)。

---

## 1. スコープと非スコープ

| | 内容 |
|---|---|
| **本 PR（PR3）** | `interview_ai_sessions` / `interview_ai_results` の table + trigger + 部分 unique index + RLS |
| 非スコープ | `quotas.ts` への `interview-ai` 追加 / repository / `/api/interview-ai/*` route / recordUsage・compare-and-set 実装 / STT / quota UI |

既存 `interview_practice_records`（§53）とは **別系統**。§53 は既存の手入力面接記録の localStorage mirror、
本系統は対話型リアルタイム面接 AI セッション（別 feature・別課金単位・別冪等化）。混同しないこと。

---

## 2. DDL（§56–§60 抜粋）

```sql
-- 56. interview_ai_sessions
CREATE TABLE interview_ai_sessions (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source          text         NOT NULL,            -- CHECK (voice|text)
  status          text         NOT NULL DEFAULT 'in_progress', -- CHECK (in_progress|completed|abandoned)
  usage_recorded  boolean      NOT NULL DEFAULT false,
  target_ref      jsonb        NOT NULL DEFAULT '{}'::jsonb,   -- アプリ契約で version キーを含む
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  metadata        jsonb        NOT NULL DEFAULT '{}'::jsonb
);
-- 57. trigger set_updated_at + 部分 unique index（in_progress を user 1 件に制限）
CREATE UNIQUE INDEX interview_ai_sessions_one_in_progress
  ON interview_ai_sessions (user_id) WHERE status = 'in_progress';
-- 58. RLS: owner select/insert/update/delete（auth.uid() = user_id）

-- 59. interview_ai_results
CREATE TABLE interview_ai_results (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid         NOT NULL REFERENCES interview_ai_sessions(id) ON DELETE CASCADE,
  user_id        uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feedback       jsonb        NOT NULL,             -- InterviewFeedback
  strengths      text[]       NOT NULL DEFAULT '{}',
  improvements   text[]       NOT NULL DEFAULT '{}',
  next_practice  text[]       NOT NULL DEFAULT '{}',
  created_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT interview_ai_results_session_unique UNIQUE (session_id)
);
-- 60. RLS: EXISTS 方式（親 interview_ai_sessions の所有を判定）
```

---

## 3. 設計判断（PR0 確定事項の反映）

| 確定事項（pr0_design.md） | スキーマでの実現 |
|---|---|
| 1 セッション 1 quota / 二重課金防止（§3） | `usage_recorded boolean DEFAULT false` を compare-and-set する |
| in_progress は user 1 件まで（§7.3 / §3.3） | `interview_ai_sessions_one_in_progress` 部分 unique index |
| source 分岐（§2） | `source` CHECK (voice, text) |
| RLS は EXISTS 方式（§6.4） | `interview_ai_results` の 4 policy が親セッション所有を EXISTS で判定 |
| target_ref に version（§6.3） | `target_ref jsonb`。version はアプリ契約（DB は shape 非強制） |
| strengths/improvements/next_practice 追加（§6.2） | `text[] NOT NULL DEFAULT '{}'` の正規化カラム |
| 音声保存なし（§7.1） | 音声列を持たない。feedback（text/jsonb）のみ |
| InterviewFeedback 再利用（§8） | `feedback jsonb` に丸ごと保存。read 側で既存 util 再利用 |

### 3.1 なぜ usage_recorded をセッション table に置くか

課金の冪等境界をセッション行に持たせることで、`UPDATE ... WHERE usage_recorded=false RETURNING id`
の単一 atomic UPDATE で「勝者プロセス 1 つ」を確定できる（pr0_design.md §3.2）。voice の STT 並列発火 /
text の二重保存 / リトライでも二重計上が起きない。

### 3.2 なぜ results は EXISTS 方式か

`user_id` を複製しているので `auth.uid()=user_id` でも閉じるが、**親セッションの所有と結果の所有が
必ず一致すること**を RLS で保証するため EXISTS を採る。session を付け替えた孤児 result を構造的に排除する。

### 3.3 service_role 経路との関係

課金計上（usage_recorded の compare-and-set）・final feedback の保存は **server-only（service_role）**
が RLS をバイパスして行う想定（recordUsage は server-only / pr0_design.md §4）。owner policy は
client の読み取り・セッション状態遷移（in_progress → completed/abandoned）のための経路。

---

## 4. operator 適用 runbook

### 4.1 適用範囲

`supabase/schema.sql` の **§56〜§60 のみ**（`CREATE TABLE interview_ai_sessions` 〜
最後の `interview_ai_results owner delete` policy まで）。`gen_random_uuid()`（§1）/
`set_updated_at()`（§3）/ `auth.users` に依存。

### 4.2 適用前確認

```sql
SELECT to_regclass('public.interview_ai_sessions') AS s,
       to_regclass('public.interview_ai_results')  AS r;
-- 期待: 両方 NULL（未適用）。非 NULL なら重複適用しない。
SELECT proname FROM pg_proc WHERE proname = 'set_updated_at';  -- 期待: 1 行
```

### 4.3 適用後確認

```sql
-- D.1 table existence（2 table）
SELECT to_regclass('public.interview_ai_sessions'), to_regclass('public.interview_ai_results');

-- D.2 CHECK 制約（source / status）
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.interview_ai_sessions'::regclass AND contype = 'c';
-- 期待: source IN (voice,text) / status IN (in_progress,completed,abandoned)

-- D.3 部分 unique index
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'interview_ai_sessions' AND indexname = 'interview_ai_sessions_one_in_progress';
-- 期待: ... WHERE (status = 'in_progress')

-- D.4 results UNIQUE(session_id)
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.interview_ai_results'::regclass AND contype = 'u';
-- 期待: interview_ai_results_session_unique

-- D.5 RLS enabled（両 table）+ policy 本数
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('interview_ai_sessions','interview_ai_results');  -- 期待: t / t
SELECT tablename, count(*) FROM pg_policies
WHERE tablename IN ('interview_ai_sessions','interview_ai_results') GROUP BY tablename;
-- 期待: 各 4 本
```

### 4.4 手動 smoke test（不変条件）

1. user A が `status='in_progress'` のセッションを 1 件 insert → 成功。
2. user A が 2 件目の `in_progress` を insert → **失敗**（部分 unique index 違反）。
3. 1 件目を `status='completed'` に update → 成功。その後 2 件目の `in_progress` insert → 成功。
4. usage_recorded compare-and-set: `UPDATE ... SET usage_recorded=true WHERE id=:id AND usage_recorded=false RETURNING id` を 2 回 → 1 回目のみ行が返る。
5. results: 同 session_id に 2 回 insert → 2 回目は UNIQUE 違反（upsert で冪等化する想定）。
6. RLS: user B が user A のセッション / 結果を select → 0 行（EXISTS / owner isolation）。

### 4.5 Rollback

```sql
DROP TABLE IF EXISTS public.interview_ai_results  CASCADE;  -- 先に子
DROP TABLE IF EXISTS public.interview_ai_sessions CASCADE;
```

本 PR は schema のみで、既存 UX から参照されていない（quota feature key 未追加 / route 未実装）。
DROP しても既存機能は無影響。

---

## 5. 後続 PR への申し送り

| PR | 内容 |
|---|---|
| 次 | `quotas.ts` に `interview-ai`（free 0 / basic 10 / premium 30）+ `UsageStatusCard` ラベル + 料金ページ |
| 次 | セッション作成 route（gate `ensurePlanQuota('interview-ai')` + in_progress insert） |
| PR6+ | `/api/interview-ai/turn`（seed/followup/turn analysis）/ STT / usage_recorded compare-and-set / recordUsage |

> **PR5 完了時点で監査レビューを挟む**（課金・STT・usage_recorded・followup 生成が絡むため）。
> 本 PR3 まではスキーマ基盤であり、課金経路は未配線。
