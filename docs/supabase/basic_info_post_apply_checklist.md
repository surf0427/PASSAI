# basicInfo Mirror — Post-Apply Verification Checklist

`supabase/schema.sql` §7–§9（`basic_info_mirrors` テーブル + trigger + RLS）を Supabase project に apply した直後〜24h の確認項目。本 checklist は **operator が手動実行** する。dashboard を作らない方針（[`observability_sink.md §6.3`](./observability_sink.md)）に沿って、すべて Supabase SQL editor 上の ad-hoc query で完結する。

関連:
- [`basic_info_mirror_schema_preview.md`](./basic_info_mirror_schema_preview.md) — schema 設計 + PII contract
- [`observability_sink.md`](./observability_sink.md) — `mirror_events` クエリ全般
- [`mirror_observability.md §14`](./mirror_observability.md) — rollout-stage 判断ルール
- [`phase1_runtime_strategy.md §15`](./phase1_runtime_strategy.md) — Phase1 卒業条件

---

## 1. Immediate verification (apply 後 30 分以内)

### 1.1 Table existence + RLS state

```sql
SELECT
  relname,
  relrowsecurity AS rls_enabled,
  relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relname = 'basic_info_mirrors';
```

期待: 1 行 / `rls_enabled = true`。

### 1.2 Policy count

```sql
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'basic_info_mirrors'
ORDER BY policyname;
```

期待: 2 行のみ。
- `basic_info_mirrors anon insert` / `INSERT` / `{anon}`
- `basic_info_mirrors anon update` / `UPDATE` / `{anon}`

**SELECT / DELETE policy が出てきたら STOP**。schema apply で意図しない policy が混入。`DROP POLICY` で除去し原因を調査。

### 1.3 Trigger presence

```sql
SELECT tgname, tgrelid::regclass, tgtype
FROM pg_trigger
WHERE tgname = 'basic_info_mirrors_set_updated_at';
```

期待: 1 行 / `tgrelid = basic_info_mirrors`。

### 1.4 Column defaults

```sql
SELECT column_name, column_default, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'basic_info_mirrors'
ORDER BY ordinal_position;
```

期待:
- `id` — `gen_random_uuid()` / NOT NULL / `uuid`
- `source_hash` — NULL default / NOT NULL / `text` (+ UNIQUE constraint separately)
- `schema_version` — NULL default / NOT NULL / `text`
- `payload` — NULL default / NOT NULL / `jsonb`
- `created_at` — `timezone('utc'::text, now())` / NOT NULL / `timestamp with time zone`
- `updated_at` — `timezone('utc'::text, now())` / NOT NULL / `timestamp with time zone`

---

## 2. Mirror flow verification (apply 後 1〜6 時間)

### 2.1 First success row appears

```sql
SELECT count(*) AS n
FROM mirror_events
WHERE feature = 'basicInfo'
  AND mirror_status = 'success'
  AND created_at >= now() - interval '6 hours';
```

期待: `n > 0`（最初の basicInfo form submit から発火）。

**0 のまま 6 時間以上経過した場合**:
- 環境変数 `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` / `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` が誤って ON になっていないか確認
- production に basicInfo form 送信トラフィックがあるか確認（rarely-edited form のため、新規 user 0 だと success row も 0）
- `feature = 'basicInfo'` 行が `failure` / `skipped` / `disabled` のいずれかに偏っていないか §2.2 で確認

### 2.2 Status distribution

```sql
SELECT
  mirror_status,
  count(*) AS n,
  ROUND(count(*)::numeric / SUM(count(*)) OVER (), 4) AS ratio
FROM mirror_events
WHERE feature = 'basicInfo'
  AND created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY 2 DESC;
```

期待ベースライン (apply 翌日):
- `success` — 主体
- `failure` — apply 直後の数件のみ（apply 完了前の attempt が `network_error` で残っているケース）。その後は限りなく 0 に近づくはず
- `skipped` — production では基本 0（env 未設定ユーザ は skip = `unsupported_environment` ではなく `failure = missing_env`。dev / preview では存在しうる）
- `disabled` — 0（kill-switch を使っていない限り）

### 2.3 PII spot-check

**最重要項目**。`payload` に `name` が **絶対に** 含まれないことを確認する。

```sql
SELECT id, payload ? 'name' AS has_name_key, payload
FROM basic_info_mirrors
ORDER BY created_at DESC
LIMIT 20;
```

期待: 全行で `has_name_key = false`。

**1 件でも `has_name_key = true` が出たら STOP**:
1. 直ちに `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` を本番に **設定 + redeploy**（`NEXT_PUBLIC_*` は build-time inlining。env 変更だけでは反映されない — [`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md)）。redeploy 完了前は **service-role で `DELETE FROM basic_info_mirrors;` を先に走らせ** stale client からの追加 PII 流入を最小化する
2. service-role 経由で `DELETE FROM basic_info_mirrors;` 実行（上記と並行可）
3. `lib/supabase/mirrorBasicInfo.ts::stripName()` のロジック検証
4. テスト追加後、kill-switch OFF（env 削除 → redeploy）
5. ポストモーテム作成

### 2.4 Failure reason distribution

```sql
SELECT failure_reason, count(*) AS n
FROM mirror_events
WHERE feature = 'basicInfo'
  AND mirror_status = 'failure'
  AND created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY 2 DESC;
```

期待 (apply 翌日):
- `network_error` — apply 直後の数件のみ。継続的に増えるならテーブル名 / RLS が壊れている可能性
- `unknown` — 0 が理想。0.5% 程度までは tolerable（[`phase1_runtime_strategy.md §15`](./phase1_runtime_strategy.md)）
- `missing_env` — production では 0（env 設定済み前提）。dev / preview では出ても問題なし
- `client_unavailable` — 0 が理想（boundary が機能していれば発生しない）
- `validation_error` / `schema_mismatch` / `rate_limited` / `auth_unavailable` — 0（basicInfo mirror は validate せず / auth 未使用 / Phase1 では rate-limit 経路無し）

### 2.5 Skip reason distribution

```sql
SELECT skip_reason, count(*) AS n
FROM mirror_events
WHERE feature = 'basicInfo'
  AND mirror_status = 'skipped'
  AND created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY 2 DESC;
```

production 期待:
- 通常はすべて 0
- `unsupported_environment` が出るのは SSR 経路で mirror helper が誤って呼ばれているサイン（要調査）
- `mirror_disabled` が出るのは kill-switch ON 中（意図的でない場合は env 設定ミス）

### 2.6 Environment split

```sql
SELECT environment, mirror_status, count(*) AS n
FROM mirror_events
WHERE feature = 'basicInfo'
  AND created_at >= now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY 1, 2;
```

期待:
- `production` — success 主体
- `preview` — success または skipped（preview に traffic がある場合）
- `development` — failure (missing_env) が出ても許容

production と preview の `success` 比率が大きく乖離していたら schema apply が preview project に届いていない可能性を確認。

---

## 3. Upsert idempotency verification (apply 後 24h 以内)

### 3.1 Duplicate-submit dedup

```sql
SELECT source_hash, count(*) AS n_rows, max(updated_at) - min(created_at) AS span
FROM basic_info_mirrors
GROUP BY source_hash
ORDER BY n_rows DESC
LIMIT 10;
```

期待: 全行で `n_rows = 1`（UNIQUE constraint により自明）。`updated_at - created_at` が長いものほど idempotent re-mirror が機能しているサイン。

### 3.2 Update vs insert ratio

直接観測は困難だが、event 数 vs row 数の比率で間接的に確認:

```sql
SELECT
  (SELECT count(*) FROM mirror_events WHERE feature='basicInfo' AND mirror_status='success' AND created_at >= now() - interval '24 hours') AS success_events,
  (SELECT count(*) FROM basic_info_mirrors WHERE updated_at >= now() - interval '24 hours') AS active_rows;
```

`success_events >= active_rows` が期待状態。差分が大きいほど re-mirror（upsert UPDATE side）が機能している。差が 0 なら毎 submit が新規 row を作っており、source_hash 計算がユーザ間でユニーク化しすぎている可能性（payload に session-unique 値が混入している疑い）。

---

## 4. Rollback / kill-switch usage

### 4.1 環境変数による段階制御

| 状況 | 設定 | 影響範囲 |
|---|---|---|
| 全 mirror 緊急停止 | `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` | studentProfile + basicInfo の両方が `mirror_events` に `disabled` として記録。upsert は実行されない |
| 観測 sink だけ停止 | `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED=true` | mirror upsert は継続。`mirror_events` への INSERT は silently skip |
| basicInfo だけ停止 | (Phase1 では未実装) | 必要になったら feature-specific kill-switch を `mirrorBasicInfo.ts` に追加 — `mirrorConfig.ts` の global 経路は使わない |

### 4.2 Disable via env (Vercel 例)

1. Vercel dashboard → Project → Settings → Environment Variables
2. `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` を `Production` scope に追加し値 `true`
3. **Redeploy 必須**（`NEXT_PUBLIC_*` は Next.js build 時に client bundle へ inlining されるため、env 変更だけでは反映されない）。Vercel UI 上では "Redeploy" ボタンを押す、または next commit の自動 deploy を待つ
4. 新 deploy 取得後の page load から kill-switch が有効。stale client（モバイル tab / PWA cache / 開きっぱなしの session）は新 deploy 取得まで旧挙動を継続する点を accept する（[`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md)）
5. 解除する場合は変数を削除 or 値を `false`（実装上 `false` は disable と見なされない / DISABLED_VALUES の挙動）に変更し、**再度 redeploy** する

`NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` も同じ操作（build-time inlining + redeploy 必須）。

### 4.3 Schema-level rollback

| アクション | コマンド | 影響 |
|---|---|---|
| Table 撤去 | `DROP TABLE basic_info_mirrors;` | mirror INSERT は `network_error` として silently 失敗。`mirror_events` の既存 row は保持。canonical (localStorage) は不変 |
| 全 row purge | `DELETE FROM basic_info_mirrors;` | service-role 経由のみ。Phase1 anon は DELETE 不可。mirror events は保持 |
| Policy 入れ替え | `DROP POLICY ... ; CREATE POLICY ...` | anon insert/update を別 role に絞るなど。Phase1 では未使用 |

---

## 5. 7-day soak observation

apply から 7 日後に以下を再確認し、basicInfo mirror を「safe to graduate from stage 1」状態と判断するための入力にする（[`mirror_observability.md §14`](./mirror_observability.md) の stage 進行と整合）。

```sql
-- 7日 success rate
SELECT
  date_trunc('day', created_at) AS day,
  count(*) FILTER (WHERE mirror_status = 'success')::numeric
    / NULLIF(count(*), 0) AS success_rate,
  count(*) AS attempts
FROM mirror_events
WHERE feature = 'basicInfo'
  AND created_at >= now() - interval '7 days'
GROUP BY 1
ORDER BY 1;
```

graduation 暫定閾値 (operator が確定するまでの作業仮説):
- 7 日連続で daily `success_rate >= 0.95`
- `unknown` failure_reason 比率 < 1%
- `disabled` rows がゼロ（kill-switch 不使用）
- PII spot-check (§2.3) を 7 日後にもう一度実行し全 row clean

これらが満たされた時点で「basicInfo mirror が production に定着」と判定。次の feature mirror (`feature_rollout_matrix.md` order 3 以降) の着手判断材料とする。

---

## 6. When NOT to use this checklist

本 checklist は **基本 verification** に限定する。以下は別 STEP / 別 doc 範囲:

- Phase1 → Phase2 移行判断 ([`migration_phases.md`](./migration_phases.md))
- 3rd feature mirror の着手判断 ([`feature_rollout_matrix.md §5`](./feature_rollout_matrix.md))
- Schema 進化（新 column 追加）の操作手順 — 別 schema STEP
- Retention 自動化 — Phase2 範囲（[`observability_sink.md §7`](./observability_sink.md)）
- Dashboard build — Phase1 では作らない（[`observability_sink.md §6.3`](./observability_sink.md)）
- Auth coupling / `user_id` 列 — Phase2 範囲

---

## 7. Sign-off

apply STEP は以下が満たされた時点で完了とする:

- [ ] §1.1〜§1.4 全項目 OK
- [ ] §2.1 で `success` row 出現を確認
- [ ] §2.3 PII spot-check で全 row clean
- [ ] §2.4 で `unknown` 比率が許容範囲内
- [ ] §4.2 で kill-switch の操作方法を operator runbook に追加（書面で保管）

未達項目があれば apply 完了とは扱わず、原因切り分けに戻る。Phase1 は「観測前の早期 graduation を避ける」ことが上位ルール。
