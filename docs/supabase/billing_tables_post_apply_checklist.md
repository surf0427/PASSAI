# billing tables（subscriptions / stripe_events / usage_records）— Post-Apply Verification Checklist

`supabase/schema.sql` §25–§31 の billing 系 3 テーブルを Supabase 本番 project に適用するための **operator 用手順書**。STEP-SUPABASE-BILLING-DB-APPLY-01。

現状（SQL Editor の `to_regclass` が NULL ＝ 未適用）:
- `public.subscriptions`
- `public.stripe_events`
- `public.usage_records`

> ⚠️ 本 STEP は **docs 作成のみ**。DB への実適用は operator が Supabase SQL Editor で手動実行する。`schema.sql` / `app` / `lib` / `types` は変更しない。SQL は schema.sql から**抽出**したものであり、再設計はしていない。

関連:
- 実装が期待する列: `lib/billing/planGate.ts`（`profiles.plan` / `is_qa_user` SELECT、`usage_records` を `status='ok'` で COUNT）、`lib/billing/usageLog.ts`（`usage_records` へ `user_id/route/model/status` を service_role insert）、`app/api/billing/webhook/route.ts`（`stripe_events` 冪等化 + `subscriptions` upsert）。
- 先行例: [`statement_review_history_post_apply_checklist.md`](./statement_review_history_post_apply_checklist.md)（構造確認の型）

---

## A. 対象範囲（schema.sql のセクション）

| § | 内容 | schema.sql 行 |
|---|---|---|
| §25 | `CREATE TABLE subscriptions` + COMMENT + INDEX ×2 | 769–817 |
| §26 | `subscriptions` trigger（`set_updated_at()` 再利用） | 820–825 |
| §27 | `subscriptions` RLS（owner select のみ） | 828–837 |
| §28 | `CREATE TABLE stripe_events` + COMMENT + INDEX ×2 | 849–878 |
| §29 | `stripe_events` RLS（policy なし＝全 deny） | 881–884 |
| §30 | `CREATE TABLE usage_records` + COMMENT + INDEX ×2 | 899–935 |
| §31 | `usage_records` RLS（owner select のみ） | 938–946 |

§C に実行可能 SQL の全文を貼付。

---

## B. 依存関係

| 依存 | 必要か | 備考 |
|---|---|---|
| `auth.users` | **必須** | `subscriptions.user_id` / `usage_records.user_id` の FK 先（`REFERENCES auth.users(id) ON DELETE CASCADE`）。Supabase Auth 有効 project なら既存 |
| `set_updated_at()`（schema.sql §3） | **必須**（subscriptions のみ） | §26 trigger が依存。`profiles` が既に適用済み（= §3 適用済み）なので存在するはず。§B.1 で確認 |
| `public.profiles` | **FK 依存なし** | この 3 テーブルは profiles を **参照しない**。`profiles.plan` / `is_qa_user` は planGate がアプリ層で読む denormalized cache であり、テーブル適用順の前提ではない。profiles は既に適用済み（NULL リストに含まれない） |
| `gen_random_uuid()` | 必須 | `id` PK のデフォルト。pgcrypto/pg 標準。既存 mirror テーブルが使用済み |
| 3 テーブル相互 | **なし** | subscriptions / stripe_events / usage_records 間に FK は無い。適用順は任意（本書は schema 順） |

結論: **profiles が既に存在していれば（= 既に適用済み）、auth.users と set_updated_at() も揃っており、本 3 テーブルはそのまま実行可能。**

---

## B.1〜B.4 適用前確認（Pre-apply）

```sql
-- B.1 set_updated_at() の存在（subscriptions trigger が依存）
SELECT proname FROM pg_proc WHERE proname = 'set_updated_at';
-- 期待: 1 行。0 行なら schema.sql §3 未適用 → 先に基盤 schema を当てる。

-- B.2 auth.users の存在（FK 先）
SELECT to_regclass('auth.users');
-- 期待: auth.users（非 NULL）。

-- B.3 profiles の存在（denormalized cache の前提。FK ではないが planGate が読む）
SELECT to_regclass('public.profiles');
-- 期待: public.profiles（非 NULL）。NULL なら profiles を先に適用すること。

-- B.4 3 テーブルが未適用であること（二重適用回避）
SELECT to_regclass('public.subscriptions')  AS subscriptions,
       to_regclass('public.stripe_events')  AS stripe_events,
       to_regclass('public.usage_records')  AS usage_records;
-- 期待: 3 つとも NULL（未作成）。
```

---

## C. 適用 SQL（コピー用全文 — schema.sql §25–§31 抽出）

> 以下を Supabase SQL Editor にそのまま貼り付けて実行する。`supabase/schema.sql` 769–946 行と同一。

```sql
-- ===== 25. subscriptions =====
CREATE TABLE subscriptions (
  id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id      text         NOT NULL,
  stripe_subscription_id  text         NOT NULL UNIQUE,
  plan                    text         NOT NULL,
  status                  text         NOT NULL,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean      NOT NULL DEFAULT false,
  created_at              timestamptz  NOT NULL DEFAULT timezone('utc', now()),
  updated_at              timestamptz  NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT subscriptions_plan_check
    CHECK (plan IN ('basic', 'premium')),
  CONSTRAINT subscriptions_status_check
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled',
                      'incomplete', 'incomplete_expired', 'unpaid', 'paused'))
);

COMMENT ON TABLE subscriptions IS
  'STEP-BILLING-01. Stripe サブスク状態の Single Source of Truth。 '
  '書き込みは service_role (webhook) のみ。SELECT は自分の行のみ。 '
  'profiles.plan は本テーブル由来の denormalized cache。 '
  '1 user が複数の subscription 行を持ち得る（plan 変更や再契約時）。';
COMMENT ON COLUMN subscriptions.user_id IS
  'auth.users(id). Owner key. RLS は auth.uid() = user_id で閉じる。';
COMMENT ON COLUMN subscriptions.stripe_customer_id IS
  'Stripe Customer ID (cus_...). user に対し 1:1 で再利用される。 '
  'Billing Portal セッション発行に必要。';
COMMENT ON COLUMN subscriptions.stripe_subscription_id IS
  'Stripe Subscription ID (sub_...). UNIQUE。webhook 冪等化と plan 切替時の '
  '同一行更新に使う upsert conflict target。';
COMMENT ON COLUMN subscriptions.plan IS
  'basic | premium。Stripe Price ID から webhook 側で導出して書く。 '
  '無料プランは存在しない（free は profiles.plan のデフォルト値で表現）。';
COMMENT ON COLUMN subscriptions.status IS
  'Stripe Subscription.status を sync。CHECK 制約で代表値を列挙。 '
  'Stripe が将来 status を追加した場合は CHECK 緩和を別 migration で。';
COMMENT ON COLUMN subscriptions.cancel_at_period_end IS
  '解約予約フラグ。true なら current_period_end まで権利維持、その後 canceled。';

CREATE INDEX subscriptions_user_id_idx ON subscriptions(user_id);
CREATE INDEX subscriptions_customer_idx ON subscriptions(stripe_customer_id);


-- ===== 26. subscriptions trigger（set_updated_at() は §3 で定義済み）=====
CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- ===== 27. subscriptions RLS（書き込み policy なし＝service_role のみ）=====
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions owner select"
  ON subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);


-- ===== 28. stripe_events — webhook 冪等化ストア =====
CREATE TABLE stripe_events (
  event_id      text         PRIMARY KEY,
  type          text         NOT NULL,
  payload       jsonb        NOT NULL,
  received_at   timestamptz  NOT NULL DEFAULT timezone('utc', now()),
  processed_at  timestamptz,
  error         text
);

COMMENT ON TABLE stripe_events IS
  'STEP-BILLING-01. Stripe webhook event の冪等化ストア。event_id PK で '
  'INSERT ... ON CONFLICT DO NOTHING により再送イベントを安全に弾く。 '
  '書き込み・読み取りともに service_role のみ。';
COMMENT ON COLUMN stripe_events.event_id IS
  'Stripe Event ID (evt_...). UNIQUE conflict target。';
COMMENT ON COLUMN stripe_events.type IS
  'Stripe event type (例: customer.subscription.created, '
  'checkout.session.completed)。';
COMMENT ON COLUMN stripe_events.payload IS
  'Stripe event body をそのまま保存。デバッグ・再処理用。 '
  'PII を含み得る（メール等）ので運用上の取扱注意。';
COMMENT ON COLUMN stripe_events.processed_at IS
  'NULL=受信したが未処理。値あり=処理成功。エラー時は error 列に詳細。';

CREATE INDEX stripe_events_type_idx ON stripe_events(type);
CREATE INDEX stripe_events_received_idx ON stripe_events(received_at DESC);


-- ===== 29. stripe_events RLS（policy 一切なし＝anon/authenticated 全 deny）=====
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;


-- ===== 30. usage_records — AI 利用量・原価分析の土台（軽量版）=====
CREATE TABLE usage_records (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route        text         NOT NULL,
  model        text         NOT NULL,
  status       text         NOT NULL,
  occurred_at  timestamptz  NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT usage_records_status_check
    CHECK (status IN ('ok', 'error', 'rate_limited'))
);

COMMENT ON TABLE usage_records IS
  'STEP-BILLING-01. AI API 利用記録の最小版。route 別・user 別の利用回数 '
  '集計と plan 別上限判定の基盤。トークン数 / 原価カラムは将来 ALTER TABLE '
  'で後方互換に追加。書き込みは service_role のみ。SELECT は自分の行のみ。';
COMMENT ON COLUMN usage_records.user_id IS
  'auth.users(id). Owner key.';
COMMENT ON COLUMN usage_records.route IS
  'AI を呼び出した API route の識別子。例: "statement-review", "tutor"。 '
  'app/api/<name>/route.ts の <name> 部分を使う。';
COMMENT ON COLUMN usage_records.model IS
  'Anthropic model ID。例: "claude-sonnet-4-6", "claude-opus-4-1"。';
COMMENT ON COLUMN usage_records.status IS
  'ok / error / rate_limited。CHECK 制約で固定。';
COMMENT ON COLUMN usage_records.occurred_at IS
  'AI call 実行時刻。INSERT 時のデフォルトで now() を入れる。 '
  '日次集計はこの列で行う。';

CREATE INDEX usage_records_user_occurred_idx
  ON usage_records(user_id, occurred_at DESC);
CREATE INDEX usage_records_route_occurred_idx
  ON usage_records(route, occurred_at DESC);


-- ===== 31. usage_records RLS（書き込み policy なし＝service_role のみ）=====
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_records owner select"
  ON usage_records
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
```

---

## D. 適用後確認 SQL（構造検証）

### D.1 Table existence
```sql
SELECT to_regclass('public.subscriptions')  AS subscriptions,
       to_regclass('public.stripe_events')  AS stripe_events,
       to_regclass('public.usage_records')  AS usage_records;
```
期待: 3 つとも非 NULL（`public.<name>`）。

### D.2 Columns（impl との整合確認）
```sql
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('subscriptions', 'stripe_events', 'usage_records')
ORDER BY table_name, ordinal_position;
```
期待:
- **subscriptions（11 列）**: id / user_id / stripe_customer_id / stripe_subscription_id / plan / status / current_period_start / current_period_end / cancel_at_period_end / created_at / updated_at
- **stripe_events（6 列）**: event_id / type / payload / received_at / processed_at / error
- **usage_records（6 列）**: id / user_id / route / model / status / occurred_at

> impl 整合: `usageLog.ts` は `user_id/route/model/status` を insert（`occurred_at` は default）。`webhook` は `subscriptions` を `stripe_subscription_id` 衝突で upsert、`stripe_events` を `event_id` で冪等化。`planGate` は `usage_records` を `status='ok'` + `occurred_at` 月境界 + `route` で COUNT。すべて上記列名と一致。

### D.3 Constraints（UNIQUE / CHECK）
```sql
SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN ('public.subscriptions'::regclass,
                   'public.stripe_events'::regclass,
                   'public.usage_records'::regclass)
ORDER BY tbl, conname;
```
期待:
- `subscriptions`: PK(id) / FK→auth.users / `UNIQUE (stripe_subscription_id)` / `subscriptions_plan_check CHECK (plan IN ('basic','premium'))` / `subscriptions_status_check CHECK (...8値...)`
- `stripe_events`: PK(event_id)
- `usage_records`: PK(id) / FK→auth.users / `usage_records_status_check CHECK (status IN ('ok','error','rate_limited'))`

### D.4 Indexes
```sql
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('subscriptions', 'stripe_events', 'usage_records')
ORDER BY tablename, indexname;
```
期待: `subscriptions_user_id_idx` / `subscriptions_customer_idx` / `stripe_events_type_idx` / `stripe_events_received_idx` / `usage_records_user_occurred_idx` / `usage_records_route_occurred_idx`（＋各 PK / UNIQUE 由来 index）。

### D.5 Trigger（subscriptions のみ）
```sql
SELECT tgname, tgrelid::regclass, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid IN ('public.subscriptions'::regclass,
                  'public.stripe_events'::regclass,
                  'public.usage_records'::regclass)
  AND NOT tgisinternal;
```
期待: `subscriptions_set_updated_at`（BEFORE UPDATE, `set_updated_at()`）の **1 件のみ**。stripe_events / usage_records は append-only で `updated_at` 列を持たず、trigger 無しが正。

### D.6 RLS enabled
```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE oid IN ('public.subscriptions'::regclass,
              'public.stripe_events'::regclass,
              'public.usage_records'::regclass);
```
期待: 3 つとも `relrowsecurity = true`。

### D.7 Policies
```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('subscriptions', 'stripe_events', 'usage_records')
ORDER BY tablename, policyname;
```
期待（§F の表）。

---

## E. 手動 smoke test（owner-isolation）

> ⚠️ SQL Editor の実行ロールは通常 `postgres`（service_role 相当・BYPASSRLS）であり、RLS をバイパスする。owner-isolation を「弾かれること」まで含めて正しく検証するには **authenticated JWT を持つ Supabase client** が必要。SQL Editor では **§D の構造確認まで**を対象とする。

実 RLS 検証（後日 / client 経由）の観点:
- `subscriptions` / `usage_records`: 別 user の行が SELECT で見えない（owner select のみ）。
- 書き込み: authenticated client から `subscriptions` / `usage_records` への INSERT/UPDATE が **policy 不在で拒否**される（書き込みは service_role webhook / API route のみ）。
- `stripe_events`: authenticated から SELECT/INSERT とも全 deny。
- 実運用の書き込みは `usageLog.ts` / `webhook` が **service_role client**（`lib/supabase/serviceRoleClient.ts`）で行うため RLS をバイパスして成功する。

---

## F. 期待結果（policy / RLS の最終状態）

| テーブル | RLS | policy | roles | 書き込み経路 |
|---|---|---|---|---|
| `subscriptions` | true | `subscriptions owner select`（SELECT, `auth.uid() = user_id`）**のみ** | authenticated | service_role（webhook upsert） |
| `stripe_events` | true | **policy 0 件**（全 deny） | — | service_role（webhook） |
| `usage_records` | true | `usage_records owner select`（SELECT, `auth.uid() = user_id`）**のみ** | authenticated | service_role（API route `recordUsage`） |

構造確認サマリ:
- D.1 3 テーブル非 NULL / D.2 列数 11・6・6 / D.3 UNIQUE(stripe_subscription_id) + CHECK 2 種(subscriptions) + CHECK(usage_records) / D.5 trigger 1 件 / D.6 RLS 全 true / D.7 policy は subscriptions 1・usage_records 1・stripe_events 0。

> 注: `is_qa_user` は **`profiles` テーブル**の列（既適用）であり、本 3 テーブルには含まれない。QA bypass（planGate）の動作は本適用とは独立。

---

## G. Rollback

```sql
DROP TABLE IF EXISTS usage_records  CASCADE;
DROP TABLE IF EXISTS stripe_events  CASCADE;
DROP TABLE IF EXISTS subscriptions  CASCADE;
```
`CASCADE` で index / trigger / policy も同時に撤去。3 テーブルを参照する FK は無い（互いに独立）。`set_updated_at()`（§3 共有関数）や `profiles` は撤去しないこと。

> 既に課金データ（実 Stripe 連携）が入った後の DROP は **subscription 状態を失う**ため避ける。適用直後の検証段階でのみ rollback を使う。

---

## H. Sign-off

- [ ] §B.1 `set_updated_at()` 存在を確認
- [ ] §B.2 `auth.users` 参照可能を確認
- [ ] §B.3 `profiles` 存在を確認
- [ ] §B.4 3 テーブルが未存在（to_regclass NULL）を確認
- [ ] §C を SQL Editor で実行しエラー無し
- [ ] §D.1〜§D.7 全項目 OK（3 table / 列 / constraint / index / trigger 1 / RLS=true / policy 1・0・1）
- [ ] §E の owner-isolation / 書き込み拒否は client 経由で後日検証する旨を記録

未達項目があれば apply 完了とは扱わず、原因切り分けに戻る。
