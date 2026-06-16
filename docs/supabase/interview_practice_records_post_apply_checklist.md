# interview_practice_records — Post-Apply Verification Checklist

STEP-INTERVIEW-AI-PR1 で `supabase/schema.sql` §53–§55 に追加した
`interview_practice_records`（面接練習記録の auth-scoped durable mirror）を、operator が
Supabase project へ apply する際の手順・検証 SQL・合否基準・rollback をまとめる。

設計正本: [interview_practice_records_mirror_schema_preview.md](./interview_practice_records_mirror_schema_preview.md)。
前例: [statement_review_history_post_apply_checklist.md](./statement_review_history_post_apply_checklist.md)。

---

## A. operator が SQL Editor に流す範囲

`supabase/schema.sql` の **§53〜§55 のみ**（`CREATE TABLE interview_practice_records` 〜
最後の owner delete policy まで）。他セクションは適用済み前提。下記 C にコピー用全文を再掲する。

---

## B. 適用前確認（Pre-apply）

### B.1 共有関数 `set_updated_at()` の存在（§3 で既出）

```sql
SELECT proname FROM pg_proc WHERE proname = 'set_updated_at';
-- 期待: 1 行（set_updated_at）。0 行なら schema.sql §3 を先に適用する。
```

### B.2 `auth.users` が参照可能であること

```sql
SELECT to_regclass('auth.users') AS auth_users;
-- 期待: auth.users（NULL でないこと）。
```

### B.3 `interview_practice_records` がまだ存在しないこと（再適用防止）

```sql
SELECT to_regclass('public.interview_practice_records') AS already_exists;
-- 期待: NULL。非 NULL なら適用済み。重複適用しない（CREATE TABLE は失敗する）。
```

---

## C. 適用 SQL（コピー用全文）

`supabase/schema.sql` §53–§55 をそのまま貼り付ける。本リポジトリの schema.sql が単一情報源なので、
**ズレが出たら schema.sql 側を正** とする。

```sql
-- 53. interview_practice_records  … table + COMMENT
-- 54. trigger interview_practice_records_set_updated_at
-- 55. RLS (ENABLE + owner select/insert/update/delete)
```

> 全文は長いため schema.sql から直接コピーする。`gen_random_uuid()`（pgcrypto, §1）/
> `set_updated_at()`（§3）/ `auth.users`（§B.2）に依存する。

---

## D. 適用後確認 SQL（構造検証）

### D.1 Table existence

```sql
SELECT to_regclass('public.interview_practice_records') AS tbl;
-- 期待: public.interview_practice_records
```

### D.2 Columns check（19 列）

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'interview_practice_records'
ORDER BY ordinal_position;
-- 期待: id / user_id / local_record_id / practice_date / university_name / faculty_name /
--       exam_type / partner / main_question / improvement_summary / questions_asked /
--       my_answers / what_went_wrong / feedback_received / self_noted / feedback_json /
--       created_at / updated_at / metadata の 19 列。
--   - feedback_json: jsonb / is_nullable = YES（唯一の nullable 業務列）。
--   - text 業務列はすべて NOT NULL DEFAULT ''。metadata は NOT NULL DEFAULT '{}'。
```

### D.3 Unique constraint check

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.interview_practice_records'::regclass AND contype = 'u';
-- 期待: interview_practice_records_local_unique（= UNIQUE(user_id, local_record_id)）。
```

### D.4 Trigger check

```sql
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.interview_practice_records'::regclass AND NOT tgisinternal;
-- 期待: interview_practice_records_set_updated_at
```

### D.5 RLS enabled check

```sql
SELECT relrowsecurity FROM pg_class
WHERE oid = 'public.interview_practice_records'::regclass;
-- 期待: t（true）
```

### D.6 Policy check（4 本）

```sql
SELECT polname, cmd FROM pg_policies
  JOIN pg_class ON pg_class.relname = pg_policies.tablename
WHERE tablename = 'interview_practice_records';
-- 期待: owner select / insert / update / delete の 4 本。すべて role=authenticated。
```

---

## E. 手動 smoke test（RLS owner-isolation / upsert 冪等性）

匿名2ユーザー（A / B）で:

1. A が 1 行 upsert（`local_record_id='smoke-1'`）→ 成功。
2. A が同 `local_record_id` で再 upsert（内容変更）→ 成功（DO UPDATE 経路、行数増えない）。
3. A の SELECT → 1 行のみ。
4. B の SELECT（A の user_id を WHERE 指定しても）→ 0 行（RLS owner-isolation）。
5. B が A の行を delete → 0 行 affected（owner-scoped delete + RLS）。
6. A が自分の行を delete → 1 行 affected。

---

## F. 期待結果（合否サマリ）

| 項目 | 合格条件 |
|---|---|
| Table | `public.interview_practice_records` 存在 |
| Columns | 19 列。`feedback_json` のみ nullable jsonb |
| Unique | `(user_id, local_record_id)` |
| Trigger | `..._set_updated_at` 1 本 |
| RLS | enabled = true / policy 4 本（authenticated owner） |
| upsert | 同 natural key 再書込で行数不変（冪等） |
| RLS isolation | 他ユーザーの行が read / delete 不能 |

---

## G. Rollback

```sql
DROP TABLE IF EXISTS public.interview_practice_records CASCADE;
-- trigger / policy は table と共に削除される。set_updated_at() は共有関数なので残す。
```

mirror は best-effort（LS canonical 不変）なので、DROP しても既存 UX は無影響。

---

## H. Sign-off

- [ ] B（pre-apply）3 項目 OK
- [ ] C 適用成功
- [ ] D.1–D.6 構造検証 OK
- [ ] E smoke test OK
- [ ] 適用日 / operator 記録: __________
