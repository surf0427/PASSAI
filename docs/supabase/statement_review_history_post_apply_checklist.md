# statement_review_history — Post-Apply Verification Checklist

`supabase/schema.sql` §38–§40（`statement_review_history` table + COMMENT + trigger + RLS）を Supabase project に apply するための **operator 用手順書**。STEP-SUPABASE-COMPLETE-06-DB-APPLY。

本テーブルは **auth-scoped 系統**（self_prs / self_analysis_logs / tutor_chat_* 同系）であり `mirror_events` 系統ではないため、検証は **構造確認**（table / 列 / UNIQUE / trigger / RLS / policy）と、helper 経由の **RLS owner-isolation・upsert 冪等性** に絞る。`mirror_events` の success_rate / failure_reason 分布チェックは適用しない。

statement_review_history は **delete を伴う feature**（id 指定削除＋10 件 cap eviction）だが、本 STEP では上り mirror（upsert-only）のみで restore は未実装（06E）。delete policy は owner-isolation の一部として存在確認するに留める。

関連:
- [`statement_review_history_mirror_schema_preview.md`](./statement_review_history_mirror_schema_preview.md) — schema 設計（06A）
- [`schema_apply_preflight.md`](./schema_apply_preflight.md) — apply 前提条件
- 先行例: [`self_prs_post_apply_checklist.md`](./self_prs_post_apply_checklist.md)（05A）

> ⚠️ 本 STEP（06-DB-APPLY）は **docs 作成のみ**。DB への実適用は operator が Supabase SQL Editor で手動実行する。app / lib / types / schema.sql は変更しない。

---

## A. operator が SQL Editor に流す範囲

`supabase/schema.sql` の **§38〜§40 全体**（行 1151〜1257）。内訳:

1. **§38** `CREATE TABLE statement_review_history`（10 列 + UNIQUE 制約）
2. **§38** `COMMENT ON TABLE / COLUMN ×4 / CONSTRAINT`
3. **§39** `CREATE TRIGGER statement_review_history_set_updated_at`（共有 `set_updated_at()` 再利用）
4. **§40** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
5. **§40** owner policy 4 件（`select` / `insert` / `update` / `delete`）

§C にコピー可能な全文を貼付。既存 §（§3 の `set_updated_at()` / `auth.users` 等）には触れない additive 適用。

---

## B. 適用前確認（Pre-apply）

### B.1 共有関数 set_updated_at() の存在

§39 trigger は `set_updated_at()`（schema.sql §3 で定義済み）に依存する。

```sql
SELECT proname
FROM pg_proc
WHERE proname = 'set_updated_at';
```

期待: 1 行。**0 行なら schema.sql §3 が未適用** → 基盤 schema を先に apply すること。

### B.2 auth.users が参照可能であること

§38 の `user_id ... REFERENCES auth.users(id)` は `auth.users` の存在に依存する（Supabase Auth 有効プロジェクトなら既存）。

```sql
SELECT to_regclass('auth.users');
```

期待: `auth.users`（非 NULL）。**NULL なら Auth スキーマ未初期化** → STOP。

### B.3 statement_review_history がまだ存在しないこと

二重適用・既存上書きを避けるため、適用前に未存在を確認する。

```sql
SELECT to_regclass('public.statement_review_history');
```

期待: **NULL（未作成）**。非 NULL（= 既に存在）なら、想定外の先行適用 → 内容を確認し、不要なら §G の rollback 後に再適用するか、apply を中止する。

---

## C. 適用 SQL（コピー用全文）

> 以下を Supabase SQL Editor にそのまま貼り付けて実行する。`supabase/schema.sql` §38〜§40 と同一。

```sql
-- 38. statement_review_history
CREATE TABLE statement_review_history (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_review_id  text         NOT NULL,
  university       text         NOT NULL DEFAULT '',
  faculty          text         NOT NULL DEFAULT '',
  department       text         NOT NULL DEFAULT '',
  essay            text         NOT NULL DEFAULT '',
  result           jsonb        NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT statement_review_history_local_unique UNIQUE (user_id, local_review_id)
);

COMMENT ON TABLE statement_review_history IS
  'STEP-SUPABASE-COMPLETE-06A. localStorage statementReviewHistory（志望理由書 添削履歴）の '
  'auth-scoped Supabase durable mirror。localStorage canonical は維持し、本 table は同期先。'
  'natural key = (user_id, local_review_id)。local_review_id = ReviewHistoryItem.id, '
  'result = StatementResult 全体（jsonb）。ReviewHistoryItem は不変で、inputHash では dedup しない。'
  'delete を伴う feature であり、restore は tombstone 設計後の別 STEP に分離する。';

COMMENT ON COLUMN statement_review_history.user_id IS
  'auth.users(id). Owner key. RLS gate uses auth.uid() = user_id.';

COMMENT ON COLUMN statement_review_history.local_review_id IS
  'localStorage の ReviewHistoryItem.id（crypto.randomUUID() 由来の UUID 文字列）をそのまま入れる。'
  'natural key の一部で upsert の onConflict 対象。inputHash / contentHash ではなく id を identity とする。';

COMMENT ON COLUMN statement_review_history.result IS
  'ReviewHistoryItem.result（StatementResult 全体）を jsonb 丸ごと保存。'
  'overallScore / evaluations / strengths / weaknesses / actions / partialRevision / checklist を含む。'
  '表示時の score 正規化は read 側（normalizeStatementScore）が担保し、本 mirror は raw を忠実保存する。';

COMMENT ON COLUMN statement_review_history.created_at IS
  'ReviewHistoryItem.createdAt を backfill 時に原値保持する（LS の作成時刻）。';

COMMENT ON CONSTRAINT statement_review_history_local_unique ON statement_review_history IS
  'UNIQUE(user_id, local_review_id)。ReviewHistoryItem.id を natural key とし、onConflict 指定の '
  'upsert を冪等化するための制約。inputHash / contentHash は使わない。';


-- 39. trigger: keep updated_at fresh (re-uses set_updated_at() from §3)
CREATE TRIGGER statement_review_history_set_updated_at
  BEFORE UPDATE ON statement_review_history
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- 40. RLS — statement_review_history
ALTER TABLE statement_review_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "statement_review_history owner select"
  ON statement_review_history
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "statement_review_history owner insert"
  ON statement_review_history
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "statement_review_history owner update"
  ON statement_review_history
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "statement_review_history owner delete"
  ON statement_review_history
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
```

---

## D. 適用後確認 SQL（構造検証）

### D.1 Table existence

```sql
select to_regclass('public.statement_review_history');
```

期待: `public.statement_review_history`（非 NULL）。

### D.2 Columns check

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'statement_review_history'
order by ordinal_position;
```

期待: **10 列**（順に）
- `id` — uuid / NO / `gen_random_uuid()`
- `user_id` — uuid / NO / （null）
- `local_review_id` — text / NO / （null）
- `university` — text / NO / `''::text`
- `faculty` — text / NO / `''::text`
- `department` — text / NO / `''::text`
- `essay` — text / NO / `''::text`
- `result` — jsonb / NO / （null）
- `created_at` — timestamp with time zone / NO / `now()`
- `updated_at` — timestamp with time zone / NO / `now()`

### D.3 Unique constraint check

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.statement_review_history'::regclass;
```

期待: `statement_review_history_local_unique` / `UNIQUE (user_id, local_review_id)`。
（FK `... REFERENCES auth.users(id) ON DELETE CASCADE` と PRIMARY KEY も併せて出る。）

### D.4 Trigger check

```sql
select tgname, tgrelid::regclass, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'public.statement_review_history'::regclass
  and not tgisinternal;
```

期待: `statement_review_history_set_updated_at` / `statement_review_history` / `... BEFORE UPDATE ... EXECUTE FUNCTION set_updated_at()`。

### D.5 RLS enabled check

```sql
select relname, relrowsecurity
from pg_class
where oid = 'public.statement_review_history'::regclass;
```

期待: `relrowsecurity = true`。

### D.6 Policy check

```sql
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'statement_review_history'
order by policyname;
```

期待: **4 行のみ**、すべて `roles = {authenticated}`。
- `statement_review_history owner delete` / `DELETE` / qual=`(auth.uid() = user_id)` / with_check=（null）
- `statement_review_history owner insert` / `INSERT` / qual=（null） / with_check=`(auth.uid() = user_id)`
- `statement_review_history owner select` / `SELECT` / qual=`(auth.uid() = user_id)` / with_check=（null）
- `statement_review_history owner update` / `UPDATE` / qual=`(auth.uid() = user_id)` / with_check=`(auth.uid() = user_id)`

`{anon}` / `{public}` ロールや想定外 policy が出たら **STOP**。

---

## E. 手動 smoke test（RLS owner-isolation / upsert 冪等性）

> ⚠️ **SQL Editor では authenticated user context（`auth.uid()` が特定ユーザの sub に解決される状態）を忠実に再現しにくい。** SQL Editor の実行ロールは通常 `postgres`（service_role 相当の特権）であり、RLS を**バイパス**して評価されるため、owner-isolation を「弾かれること」まで含めて正しく検証できない。`auth.uid()` も多くの場合 NULL になり、`WITH CHECK (auth.uid() = user_id)` の本来の挙動を観測できない。

したがって本 STEP の SQL Editor 作業は **§D の構造確認まで**を対象とする。実際の owner-isolation / upsert 冪等性は、次のいずれかで検証する:

1. **06B helper 経由**（推奨）: `lib/supabase/statementReviewHistory.ts` の `upsertStatementReviewToSupabase` / `listStatementReviewsFromSupabase` を、匿名 Auth 済みの **browser Supabase client**（authenticated JWT）から呼び、`auth.uid()` が実ユーザに解決される文脈で確認する。
2. **2 ユーザ JWT** を用意し、Supabase client（authenticated role）でそれぞれ実行する。

参考シナリオ（client 文脈で実施）:

```text
[upsert 冪等性] user A の client で
  upsert({ local_review_id:'r1', university:'X', result:{...} }) を 2 回
  → list で count = 1（行が増えない）。2 回目で updated_at > created_at（trigger 動作）

[owner isolation] user B の client で
  list() → user A の 'r1' が見えない（0 件）
  user A の uid を user_id に詐称した insert → WITH CHECK 違反で失敗

[delete isolation] user B の client で user A の行 delete → 0 件
                   user A の client で自分の行 delete → 成功
```

> 補足: statement_review_history は **eviction / id 削除を DB に伝播しない上り mirror**（preview §8・§9）。06B helper は upsert と list のみで delete は実装しない（delete helper / restore は 06E）。よって本 STEP の検証対象は upsert 冪等性 + select owner-isolation が中心で、delete policy は §D.6 の**存在確認のみ**でよい。

---

## F. 期待結果（合否サマリ）

| 項目 | 期待 |
|---|---|
| D.1 to_regclass | `public.statement_review_history` |
| D.2 columns | **10 列**（id / user_id / local_review_id / university / faculty / department / essay / result / created_at / updated_at） |
| D.3 unique constraint | `statement_review_history_local_unique` = `UNIQUE (user_id, local_review_id)` |
| D.4 trigger | `statement_review_history_set_updated_at`（BEFORE UPDATE, `set_updated_at()`） |
| D.5 relrowsecurity | `true` |
| D.6 policy | **4 件**（select / insert / update / delete、すべて `{authenticated}`） |

すべて一致で構造適用 OK。owner-isolation / 冪等性は §E（client 経由）で別途確認。

---

## G. Rollback

| アクション | コマンド | 影響 |
|---|---|---|
| **table 撤去** | `DROP TABLE IF EXISTS statement_review_history CASCADE;` | trigger / policy も同時に落ちる。mirror は client 側 best-effort のため canonical（localStorage `statementReviewHistory`）は不変。UI に影響なし |
| 全 row purge | `DELETE FROM statement_review_history WHERE user_id = '<uuid>';` | 特定ユーザの replica のみ削除。canonical 不変 |

> 本 STEP は **release 前の additive schema**（新規 §38〜§40 のみ、既存オブジェクト不変）であり、誰も読まない durable mirror を足すだけなので **通常 rollback は不要**。適用に問題が出た場合のみ上記 `DROP TABLE ... CASCADE` で完全撤去できる。`CASCADE` は trigger・policy をまとめて落とすため（本テーブルを参照する FK は無いが運用一貫性のため既定とする）。

---

## H. Sign-off

apply STEP は以下が満たされた時点で完了:

- [ ] §B.1 `set_updated_at()` 存在を確認
- [ ] §B.2 `auth.users` 参照可能を確認
- [ ] §B.3 適用前に `statement_review_history` が未存在を確認
- [ ] §C を SQL Editor で実行しエラー無し
- [ ] §D.1〜§D.6 全項目 OK（table / 10 列 / UNIQUE / trigger / RLS=true / 4 policy）
- [ ] §E の owner-isolation / upsert 冪等性は 06B helper（client 経由）で検証する旨を記録（本 STEP では構造確認まで）

未達項目があれば apply 完了とは扱わず、原因切り分けに戻る。次工程は **06B**（`lib/supabase/statementReviewHistory.ts` + repository 骨組み）。
