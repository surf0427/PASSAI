# self_prs — Post-Apply Verification Checklist

`supabase/schema.sql` §35–§37（`self_prs` table + trigger + RLS）を Supabase project に apply した直後の確認項目。

本テーブルは **auth-scoped 系統**（self_analysis_logs / tutor_chat_* 同系）であり `mirror_events` 系統ではないため、検証は **RLS owner-isolation**（delete を含む）と **upsert 冪等性** に絞る。`mirror_events` の success_rate / failure_reason 分布チェックは適用しない。

selfPR は **delete を伴う feature** であるため、本 checklist は通常の owner-isolation に加えて **delete policy の owner-isolation** を独立項目として確認する。

関連:
- [`self_prs_mirror_schema_preview.md`](./self_prs_mirror_schema_preview.md) — schema 設計
- [`schema_apply_preflight.md`](./schema_apply_preflight.md) — apply 前提条件

> ⚠️ 本 STEP（05A）時点では **DB へ未適用**。本 checklist は apply STEP を別途実行する operator 向けの手順書である。

---

## 1. Pre-apply 前提確認

### 1.1 共有関数 set_updated_at() の存在

§36 trigger は `set_updated_at()`（schema.sql §3 で定義済み）に依存する。apply 前に存在を確認:

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
WHERE relname = 'self_prs';
```

期待: 1 行 / `rls_enabled = true`。

### 2.2 Column definitions

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'self_prs'
ORDER BY ordinal_position;
```

期待:
- `id` — uuid / NOT NULL / `gen_random_uuid()`
- `user_id` — uuid / NOT NULL
- `local_pr_id` — text / NOT NULL
- `pr_index` — integer / NOT NULL / `0`
- `title` — text / NOT NULL / `''::text`
- `body` — text / NOT NULL / `''::text`
- `latest_result` — text / NOT NULL / `''::text`
- `seed_input_hash` — text / **NULLABLE**
- `created_at` / `updated_at` — timestamptz / NOT NULL / `now()`
- `metadata` — jsonb / NOT NULL / `'{}'::jsonb`

### 2.3 UNIQUE constraint

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'self_prs'::regclass
  AND contype = 'u';
```

期待: `self_prs_local_unique` / `UNIQUE (user_id, local_pr_id)`。

### 2.4 Trigger presence

```sql
SELECT tgname, tgrelid::regclass
FROM pg_trigger
WHERE tgname = 'self_prs_set_updated_at';
```

期待: 1 行 / `tgrelid = self_prs`。

### 2.5 Policy list

```sql
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'self_prs'
ORDER BY policyname;
```

期待: **4 行のみ**、すべて `roles = {authenticated}`。
- `self_prs owner select` / `SELECT`
- `self_prs owner insert` / `INSERT`
- `self_prs owner update` / `UPDATE`
- `self_prs owner delete` / `DELETE`

`{anon}` / `{public}` ロールや想定外の policy が出たら **STOP**。

---

## 3. RLS owner-isolation 検証

匿名 Auth 2 ユーザ（user A / user B）の JWT を使い、それぞれ authenticated role で実行する（Supabase の `auth.uid()` が各 JWT の sub に解決される前提）。

### 3.1 同一 user で insert / select / update できる（user A）

```sql
-- user A の JWT context で実行
INSERT INTO self_prs (user_id, local_pr_id, pr_index, title, body, latest_result)
VALUES (auth.uid(), 'local-A-1', 1, 'PR A', 'body v1', 'result v1');

SELECT count(*) FROM self_prs WHERE local_pr_id = 'local-A-1';
-- 期待: 1

UPDATE self_prs
SET body = 'body v2'
WHERE local_pr_id = 'local-A-1';
-- 期待: UPDATE 1。updated_at が created_at より後になる（trigger 動作確認）
```

### 3.2 別 user の行が見えない（user B）

```sql
-- user B の JWT context で実行
SELECT count(*) FROM self_prs WHERE local_pr_id = 'local-A-1';
-- 期待: 0（RLS により user A の行は不可視）

UPDATE self_prs SET body = 'hijack' WHERE local_pr_id = 'local-A-1';
-- 期待: UPDATE 0（他人行は更新できない）
```

### 3.3 user_id 偽装 insert が弾かれる（user B）

```sql
-- user B の JWT context で、user A の uid を詐称
INSERT INTO self_prs (user_id, local_pr_id, body)
VALUES ('<user-A-uuid>', 'local-spoof', 'x');
-- 期待: WITH CHECK 違反で失敗（new row violates row-level security policy）
```

---

## 4. delete policy の owner-isolation 検証

selfPR は delete feature であるため、delete が **owner 限定**であることを独立に確認する。

### 4.1 他人の行は削除できない（user B）

```sql
-- user B の JWT context で、user A の行（§3.1 で作成）を削除しようとする
DELETE FROM self_prs WHERE local_pr_id = 'local-A-1';
-- 期待: DELETE 0（USING (auth.uid() = user_id) により対象行が 0 件）
```

### 4.2 自分の行は削除できる（user A）

```sql
-- user A の JWT context で実行
DELETE FROM self_prs WHERE local_pr_id = 'local-A-1';
-- 期待: DELETE 1

SELECT count(*) FROM self_prs WHERE local_pr_id = 'local-A-1';
-- 期待: 0
```

---

## 5. UNIQUE(user_id, local_pr_id) による upsert 冪等性確認（user A）

localStorage の「同一 `SelfPR.id` は同一カードの in-place update」という挙動を、`onConflict (user_id, local_pr_id)` の upsert で再現できることを確認する。

```sql
-- 1 回目: INSERT
INSERT INTO self_prs (user_id, local_pr_id, pr_index, body)
VALUES (auth.uid(), 'local-A-2', 1, 'v1')
ON CONFLICT (user_id, local_pr_id)
DO UPDATE SET pr_index = EXCLUDED.pr_index, body = EXCLUDED.body;

-- 2 回目: 同一 (user_id, local_pr_id) → 同一行を UPDATE（行数は増えない）
INSERT INTO self_prs (user_id, local_pr_id, pr_index, body)
VALUES (auth.uid(), 'local-A-2', 2, 'v2')
ON CONFLICT (user_id, local_pr_id)
DO UPDATE SET pr_index = EXCLUDED.pr_index, body = EXCLUDED.body;

SELECT count(*) AS rows, max(body) AS body, max(pr_index) AS pr_index
FROM self_prs WHERE local_pr_id = 'local-A-2';
-- 期待: rows = 1 / body = 'v2' / pr_index = 2。updated_at > created_at
```

検証後はテスト行を片付ける:

```sql
DELETE FROM self_prs WHERE local_pr_id IN ('local-A-1', 'local-A-2');
```

---

## 6. Rollback

| アクション | コマンド | 影響 |
|---|---|---|
| **table 撤去（rollback 既定）** | `DROP TABLE self_prs CASCADE;` | trigger / policy も同時に落ちる。mirror 書き込みは client 側で best-effort のため、canonical（localStorage `selfPRs`）は不変。UI に影響なし |
| 全 row purge | `DELETE FROM self_prs WHERE user_id = '<uuid>';` | 特定ユーザの replica のみ削除。canonical 不変 |

`CASCADE` を付ける理由: trigger・policy・将来の依存オブジェクトをまとめて撤去するため。本テーブルを参照する FK は無いが、運用上の一貫性のため CASCADE を既定とする。

---

## 7. Sign-off

apply STEP は以下が満たされた時点で完了:

- [ ] §1.1 `set_updated_at()` 存在を確認
- [ ] §2.1〜§2.5 全項目 OK（table / 列 / UNIQUE / trigger / 4 policy）
- [ ] §3.1 同一 user の insert/select/update が成功
- [ ] §3.2 別 user の行が select/update いずれも 0 件
- [ ] §3.3 user_id 偽装 insert が WITH CHECK で失敗
- [ ] §4.1 他人行の delete が 0 件 / §4.2 自分行の delete が成功
- [ ] §5 onConflict upsert で行数が増えず update される
- [ ] テスト行をクリーンアップ済み

未達項目があれば apply 完了とは扱わず、原因切り分けに戻る。
