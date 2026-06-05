# self_analysis_logs — Apply Result（STEP-SUPABASE-COMPLETE-04-DB-APPLY）

`supabase/schema.sql` §32–§34（`self_analysis_logs` table + trigger + RLS）の Supabase project 適用記録。

> ## ⚠️ 適用ステータス: **PENDING（未適用）**
>
> 本ドキュメント作成時点で、AI（Claude）は **本番 DB へ DDL を適用していない**。
> 理由:
> - 制約「operator 承認なしに本番 DB へ適用しない」。
> - DDL 適用は不可逆・外部影響のある操作であり、operator の手作業を要する。
> - ローカルに supabase CLI / migration ツールは無く、`.env.local` の接続情報を
>   無断で使った適用は行わない。
>
> 以下は operator が Supabase SQL Editor で実行するための **runbook**。
> 各 §の「結果」欄は operator が実行後に記入する（観測していない結果は記載しない）。

関連:
- [`self_analysis_logs_mirror_schema_preview.md`](./self_analysis_logs_mirror_schema_preview.md) — schema 設計
- [`self_analysis_logs_post_apply_checklist.md`](./self_analysis_logs_post_apply_checklist.md) — 検証チェックリスト（本 runbook の母体）

---

## 0. 事前条件（AI 確認済み）

| 項目 | 状態 | 根拠 |
|---|---|---|
| `set_updated_at()` が schema に定義済み | ✅ 確認済み | `supabase/schema.sql` §3（L47–55）。§33 trigger の依存を満たす |
| §32–§34 DDL の整合性 | ✅ 確認済み | `supabase/schema.sql` L958–L1036。`tutor_chat_*`（§19–§23）と同形 |
| 適用対象が新規 table のみ | ✅ 確認済み | 既存 table / policy / trigger を参照・変更しない純追加 |

> `set_updated_at()` は student_profile_mirrors / basicInfo / diagnosis / activityData /
> tutor_chat_threads で既に運用中の共有関数。本適用で**新規作成しない**（既存を再利用）。

---

## 1. 適用 SQL 全文（operator が SQL Editor に貼り付ける）

`set_updated_at()` は既存のため含めない。以下のみを実行する:

```sql
-- ========================================================================
-- STEP-SUPABASE-COMPLETE-04: self_analysis_logs
-- 依存: set_updated_at()（既存・schema.sql §3）。新規作成しない。
-- ========================================================================

-- 32. table
CREATE TABLE self_analysis_logs (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_log_id         text,
  summary_input_hash   text         NOT NULL,
  analysis             jsonb        NOT NULL,
  displayed_questions  jsonb        NOT NULL DEFAULT '[]'::jsonb,
  answers              jsonb        NOT NULL DEFAULT '[]'::jsonb,
  deep_answers         jsonb        NOT NULL DEFAULT '[]'::jsonb,
  free_memo            text         NOT NULL DEFAULT '',
  summary              jsonb        NOT NULL,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  metadata             jsonb        NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT self_analysis_logs_dedup_unique UNIQUE (user_id, summary_input_hash)
);

COMMENT ON TABLE self_analysis_logs IS
  'STEP-SUPABASE-COMPLETE-04. localStorage selfAnalysisLogs (完了済み自己分析ログ) '
  'の auth-scoped Supabase mirror。localStorage canonical は維持し、本 table は '
  '同期先（best-effort）。user_id is the sole owner key (auth.users.id). '
  'mirror_events 系統ではなく、tutor_chat_* と同じ auth-scoped 永続層。';

COMMENT ON COLUMN self_analysis_logs.user_id IS
  'auth.users(id). Owner key. RLS gate uses auth.uid() = user_id.';

COMMENT ON COLUMN self_analysis_logs.local_log_id IS
  'localStorage の SelfAnalysisLog.id（crypto.randomUUID 由来）をそのまま入れる。'
  '将来の UI selectedLogId 復元のための traceability 用。NULL 許容。';

COMMENT ON COLUMN self_analysis_logs.summary_input_hash IS
  'localStorage 側の dedup natural key（lib/selfAnalysisLogStorage.ts: '
  'persistSelfAnalysisLog が summaryInputHash 一致で in-place 上書きする）。'
  'legacy 救済の固定値 "legacy:v1" も入りうる。';

COMMENT ON CONSTRAINT self_analysis_logs_dedup_unique ON self_analysis_logs IS
  'UNIQUE(user_id, summary_input_hash)。localStorage の "同一 summaryInputHash は '
  '同一 entry を in-place update" という挙動を、onConflict 指定の upsert で再現する '
  'ための natural key。';

-- 33. trigger（既存 set_updated_at() を再利用）
CREATE TRIGGER self_analysis_logs_set_updated_at
  BEFORE UPDATE ON self_analysis_logs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- 34. RLS
ALTER TABLE self_analysis_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "self_analysis_logs owner select"
  ON self_analysis_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "self_analysis_logs owner insert"
  ON self_analysis_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "self_analysis_logs owner update"
  ON self_analysis_logs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "self_analysis_logs owner delete"
  ON self_analysis_logs
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
```

**結果（operator 記入）**: ⬜ 実行成功 / ⬜ エラー（内容: __________）　実行日時: __________

---

## 2. 事前チェック: set_updated_at() の存在（適用前に実行）

```sql
SELECT proname FROM pg_proc WHERE proname = 'set_updated_at';
```
期待: 1 行。**0 行なら §1 を実行せず**、schema.sql §3 を先に適用する。

**結果（operator 記入）**: ⬜ 1 行（OK） / ⬜ 0 行（STOP）

---

## 3. 構造確認（適用後）

### 3.1 table + RLS 有効
```sql
SELECT relname, relrowsecurity AS rls_enabled
FROM pg_class WHERE relname = 'self_analysis_logs';
```
期待: 1 行 / `rls_enabled = true`。

**結果**: ⬜ OK / ⬜ NG（__________）

### 3.2 列定義
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'self_analysis_logs'
ORDER BY ordinal_position;
```
期待: 14 列（`id`/`user_id`/`local_log_id`/`summary_input_hash`/`analysis`/`displayed_questions`/`answers`/`deep_answers`/`free_memo`/`summary`/`created_at`/`updated_at`/`metadata`）。jsonb 配列列は DEFAULT `'[]'::jsonb`、`free_memo` DEFAULT `''`、`metadata` DEFAULT `'{}'::jsonb`。

**結果**: ⬜ OK / ⬜ NG（__________）

### 3.3 UNIQUE 制約
```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'self_analysis_logs'::regclass AND contype = 'u';
```
期待: `self_analysis_logs_dedup_unique` / `UNIQUE (user_id, summary_input_hash)`。

**結果**: ⬜ OK / ⬜ NG（__________）

### 3.4 trigger
```sql
SELECT tgname, tgrelid::regclass
FROM pg_trigger WHERE tgname = 'self_analysis_logs_set_updated_at';
```
期待: 1 行 / `tgrelid = self_analysis_logs`。

**結果**: ⬜ OK / ⬜ NG（__________）

### 3.5 policy（4 件・すべて authenticated）
```sql
SELECT policyname, cmd, roles
FROM pg_policies WHERE tablename = 'self_analysis_logs'
ORDER BY policyname;
```
期待: 4 行（owner select/insert/update/delete）、すべて `roles = {authenticated}`。`{anon}` / `{public}` が出たら STOP。

**結果**: ⬜ 4 件 OK / ⬜ NG（__________）

---

## 4. RLS owner-isolation（適用後・匿名 Auth 2 ユーザで）

手順は [`self_analysis_logs_post_apply_checklist.md`](./self_analysis_logs_post_apply_checklist.md) §3 を参照。要点:

| テスト | 期待 | 結果 |
|---|---|---|
| user A: insert/select/update 自分の行 | 成功・`updated_at > created_at` | ⬜ |
| user B: user A の行を select | 0 件（不可視） | ⬜ |
| user B: user A の行を update / delete | 0 件（不可） | ⬜ |
| user B: `user_id` を A に偽装して insert | WITH CHECK 違反で失敗 | ⬜ |

---

## 5. UNIQUE upsert 冪等性（適用後・user A で）

checklist §4 の SQL を実行（`ON CONFLICT (user_id, summary_input_hash) DO UPDATE`）。

| テスト | 期待 | 結果 |
|---|---|---|
| 同一 hash で 2 回 upsert | 行数 1 のまま / 後勝ち値 / `updated_at > created_at` | ⬜ |
| 異なる hash で upsert | 新規行追加 | ⬜ |
| テスト行クリーンアップ | `DELETE ... WHERE summary_input_hash IN ('hash-A-1','hash-A-2')` | ⬜ |

---

## 5.5 E2E 事前準備: localStorage flag 初期化

backfill / restore は `lib/repository/backfillFlag.ts` の flag で **userId × feature 単位で 1 回限り**に
制御される。E2E で「上り backfill」「下り restore」を意図的に再実行するには、ブラウザの
localStorage flag を初期化する。

保存場所（コード根拠: `lib/repository/backfillFlag.ts`）:
- key: `supabaseBackfill`
- 値の構造: `{ [userId]: { [feature]: { version: number; at: string } } }`
- 本機能の feature key:
  - `selfAnalysisLogs`（上り backfill, STEP-04C）
  - `selfAnalysisLogsRestore`（下り restore, STEP-04E-2）

DevTools Console での初期化手順（対象ブラウザ profile で実行）:

```js
// (a) 全 backfill flag をまるごと消す（tutor 含む全 feature を再実行可能にする）
localStorage.removeItem('supabaseBackfill');

// (b) selfAnalysisLogs の上り backfill だけ再実行したい（他 feature の flag は保持）
{
  const k = 'supabaseBackfill';
  const r = JSON.parse(localStorage.getItem(k) || '{}');
  for (const uid of Object.keys(r)) delete r[uid]?.selfAnalysisLogs;
  localStorage.setItem(k, JSON.stringify(r));
}

// (c) 下り restore だけ再実行したい
{
  const k = 'supabaseBackfill';
  const r = JSON.parse(localStorage.getItem(k) || '{}');
  for (const uid of Object.keys(r)) delete r[uid]?.selfAnalysisLogsRestore;
  localStorage.setItem(k, JSON.stringify(r));
}
```

実行後にページをリロードすると、AuthProvider の `profileReady` 後に
`backfillSelfAnalysisLogsOnce → restoreSelfAnalysisLogsOnce` が再度走る。

注意:
- flag は **correctness ではなく最適化**（`backfillFlag.ts` 冒頭）。消しても upsert は冪等
  （`onConflict (user_id, summary_input_hash)`）・restore は merge（削除非伝播）なので再実行は無害。
- restore の「削除非伝播」テストをする場合は、**SB に無い LS ログ**を別途用意してから (c) を実行し、
  restore 後もその LS ログが残ることを確認する（`loadSelfAnalysisLogs()` で件数確認）。
- canonical（localStorage の `selfAnalysisLogs` 本体）は消さない。消すのは `supabaseBackfill` flag のみ。

**結果（operator 記入）**: ⬜ flag 初期化して backfill/restore 再実行を確認 / ⬜ 未実施

---

## 6. Rollback 方針（適用失敗時）

| 状況 | コマンド | 備考 |
|---|---|---|
| 適用途中失敗 / 全面撤回 | `DROP TABLE IF EXISTS self_analysis_logs CASCADE;` | trigger / 4 policy も同時撤去。FK 参照する側は無い。canonical（localStorage）不変 |
| 既存 `set_updated_at()` への影響 | なし | 新規作成していないため DROP 対象外（他 table が共有中）|

> アプリ側は mirror 失敗を best-effort で握り潰す（`no-env`/`error` を discriminated result で返すのみ）。
> table が無くても read 経路は localStorage canonical のままで UI 影響なし。

---

## 7. Sign-off（operator 記入）

- [ ] §2 事前チェック OK
- [ ] §1 SQL 適用成功
- [ ] §3.1〜§3.5 構造確認 全 OK
- [ ] §4 owner-isolation 全 OK
- [ ] §5 upsert 冪等性 OK + テスト行クリーンアップ済み
- [ ] 適用日時 / 実施者 記録: __________

全項目達成で apply STEP 完了。未達があれば §6 rollback で撤回し原因切り分けに戻る。
