# self_analysis_logs — Post-Apply Verification Checklist

`supabase/schema.sql` §32–§34（`self_analysis_logs` table + trigger + RLS）を Supabase project に apply した直後の確認項目。

本テーブルは **auth-scoped 系統**（tutor_chat_* 同系）であり `mirror_events` 系統ではないため、検証は **RLS owner-isolation** と **upsert 冪等性** に絞る。`mirror_events` の success_rate / failure_reason / schema_version 分布チェックは適用しない。

関連:
- [`self_analysis_logs_mirror_schema_preview.md`](./self_analysis_logs_mirror_schema_preview.md) — schema 設計
- [`schema_apply_preflight.md`](./schema_apply_preflight.md) — apply 前提条件

> ⚠️ 本 STEP（04A）時点では **DB へ未適用**。本 checklist は apply STEP を別途実行する operator 向けの手順書である。

---

## 1. Pre-apply 前提確認

### 1.1 共有関数 set_updated_at() の存在

§33 trigger は `set_updated_at()`（schema.sql §3 で定義済み）に依存する。apply 前に存在を確認:

```sql
SELECT proname
FROM pg_proc
WHERE proname = 'set_updated_at';
```

期待: 1 行。**0 行なら schema.sql §3 が未適用** → table 追記の前に基盤 schema を先に apply すること。

---

## 2. Immediate verification（apply 後）

### 2.1 Table existence + RLS state

```sql
SELECT relname, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname = 'self_analysis_logs';
```

期待: 1 行 / `rls_enabled = true`。

### 2.2 Column definitions

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'self_analysis_logs'
ORDER BY ordinal_position;
```

期待:
- `id` — uuid / NOT NULL / `gen_random_uuid()`
- `user_id` — uuid / NOT NULL
- `local_log_id` — text / NULLABLE
- `summary_input_hash` — text / NOT NULL
- `analysis` — jsonb / NOT NULL
- `displayed_questions` / `answers` / `deep_answers` — jsonb / NOT NULL / `'[]'::jsonb`
- `free_memo` — text / NOT NULL / `''::text`
- `summary` — jsonb / NOT NULL
- `created_at` / `updated_at` — timestamptz / NOT NULL / `now()`
- `metadata` — jsonb / NOT NULL / `'{}'::jsonb`

### 2.3 UNIQUE constraint

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'self_analysis_logs'::regclass
  AND contype = 'u';
```

期待: `self_analysis_logs_dedup_unique` / `UNIQUE (user_id, summary_input_hash)`。

### 2.4 Trigger presence

```sql
SELECT tgname, tgrelid::regclass
FROM pg_trigger
WHERE tgname = 'self_analysis_logs_set_updated_at';
```

期待: 1 行 / `tgrelid = self_analysis_logs`。

### 2.5 Policy list

```sql
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'self_analysis_logs'
ORDER BY policyname;
```

期待: **4 行のみ**、すべて `roles = {authenticated}`。
- `self_analysis_logs owner select` / `SELECT`
- `self_analysis_logs owner insert` / `INSERT`
- `self_analysis_logs owner update` / `UPDATE`
- `self_analysis_logs owner delete` / `DELETE`

`{anon}` / `{public}` ロールや想定外の policy が出たら **STOP**。

---

## 3. RLS owner-isolation 検証

匿名 Auth 2 ユーザ（user A / user B）の JWT を使い、それぞれ authenticated role で実行する（Supabase の `auth.uid()` が各 JWT の sub に解決される前提）。

### 3.1 同一 user で insert / select / update できる（user A）

```sql
-- user A の JWT context で実行
INSERT INTO self_analysis_logs (user_id, local_log_id, summary_input_hash, analysis, summary)
VALUES (auth.uid(), 'local-A-1', 'hash-A-1', '{"summary":"x"}'::jsonb, '{"activitySummary":"y"}'::jsonb);

SELECT count(*) FROM self_analysis_logs WHERE summary_input_hash = 'hash-A-1';
-- 期待: 1

UPDATE self_analysis_logs
SET free_memo = 'edited'
WHERE summary_input_hash = 'hash-A-1';
-- 期待: UPDATE 1。updated_at が created_at より後になる（trigger 動作確認）
```

### 3.2 別 user の行が見えない（user B）

```sql
-- user B の JWT context で実行
SELECT count(*) FROM self_analysis_logs WHERE summary_input_hash = 'hash-A-1';
-- 期待: 0（RLS により user A の行は不可視）

UPDATE self_analysis_logs SET free_memo = 'hijack' WHERE summary_input_hash = 'hash-A-1';
-- 期待: UPDATE 0（他人行は更新できない）

DELETE FROM self_analysis_logs WHERE summary_input_hash = 'hash-A-1';
-- 期待: DELETE 0（他人行は削除できない）
```

### 3.3 user_id 偽装 insert が弾かれる（user B）

```sql
-- user B の JWT context で、user A の uid を詐称
INSERT INTO self_analysis_logs (user_id, summary_input_hash, analysis, summary)
VALUES ('<user-A-uuid>', 'hash-spoof', '{}'::jsonb, '{}'::jsonb);
-- 期待: WITH CHECK 違反で失敗（new row violates row-level security policy）
```

---

## 4. UNIQUE(user_id, summary_input_hash) による upsert 確認（user A）

localStorage の in-place update を upsert で再現できることを確認する。

```sql
-- 同一 (user_id, summary_input_hash) を onConflict upsert
INSERT INTO self_analysis_logs (user_id, local_log_id, summary_input_hash, analysis, summary, free_memo)
VALUES (auth.uid(), 'local-A-2', 'hash-A-2', '{}'::jsonb, '{}'::jsonb, 'v1')
ON CONFLICT (user_id, summary_input_hash)
DO UPDATE SET free_memo = EXCLUDED.free_memo, analysis = EXCLUDED.analysis;
-- 1 回目: INSERT

INSERT INTO self_analysis_logs (user_id, local_log_id, summary_input_hash, analysis, summary, free_memo)
VALUES (auth.uid(), 'local-A-2', 'hash-A-2', '{"summary":"updated"}'::jsonb, '{}'::jsonb, 'v2')
ON CONFLICT (user_id, summary_input_hash)
DO UPDATE SET free_memo = EXCLUDED.free_memo, analysis = EXCLUDED.analysis;
-- 2 回目: 同一行を UPDATE（行数は増えない）

SELECT count(*) AS rows, max(free_memo) AS memo
FROM self_analysis_logs WHERE summary_input_hash = 'hash-A-2';
-- 期待: rows = 1 / memo = 'v2'。updated_at > created_at
```

検証後はテスト行を片付ける:

```sql
DELETE FROM self_analysis_logs WHERE summary_input_hash IN ('hash-A-1', 'hash-A-2');
```

---

## 5. Rollback

| アクション | コマンド | 影響 |
|---|---|---|
| **table 撤去（rollback 既定）** | `DROP TABLE self_analysis_logs CASCADE;` | trigger / policy も同時に落ちる。mirror 書き込みは client 側で best-effort（no-env / error は握り潰し）のため、canonical（localStorage）は不変。UI に影響なし |
| 全 row purge | `DELETE FROM self_analysis_logs WHERE user_id = '<uuid>';` | 特定ユーザの replica のみ削除。canonical 不変 |

`CASCADE` を付ける理由: trigger・policy・将来の依存オブジェクトをまとめて撤去するため。本テーブルを参照する FK は無い（参照する側は無し）が、運用上の一貫性のため CASCADE を既定とする。

---

## 6. Sign-off

apply STEP は以下が満たされた時点で完了:

- [ ] §1.1 `set_updated_at()` 存在を確認
- [ ] §2.1〜§2.5 全項目 OK（table / 列 / UNIQUE / trigger / 4 policy）
- [ ] §3.1 同一 user の insert/select/update が成功
- [ ] §3.2 別 user の行が select/update/delete いずれも 0 件
- [ ] §3.3 user_id 偽装 insert が WITH CHECK で失敗
- [ ] §4 onConflict upsert で行数が増えず update される
- [ ] テスト行をクリーンアップ済み

未達項目があれば apply 完了とは扱わず、原因切り分けに戻る。
