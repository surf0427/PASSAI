# diagnosis Mirror — Post-Apply Verification Checklist

`supabase/schema.sql` §10–§12（`diagnosis_mirrors` テーブル + trigger + RLS）を Supabase project に apply した直後〜24h の確認項目。

basicInfo checklist と違い:
- **PII spot-check section は不要**（payload に user 自由記述が無い — `answers` は numeric index、`resultType` は enum、`resultTitle`/`resultDescription` は app-authored 静的辞書）
- `feature = 'diagnosis'` 用に query を絞る
- 7-day soak gate は同等

関連:
- [`diagnosis_mirror_schema_preview.md`](./diagnosis_mirror_schema_preview.md) — schema 設計 + sourceHash contract
- [`basic_info_post_apply_checklist.md`](./basic_info_post_apply_checklist.md) — basicInfo precedent
- [`observability_sink.md`](./observability_sink.md) — `mirror_events` クエリ全般

---

## 1. Immediate verification (apply 後 30 分以内)

### 1.1 Table existence + RLS state

```sql
SELECT
  relname,
  relrowsecurity AS rls_enabled,
  relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relname = 'diagnosis_mirrors';
```

期待: 1 行 / `rls_enabled = true`。

### 1.2 Policy count

```sql
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'diagnosis_mirrors'
ORDER BY policyname;
```

期待: 2 行のみ。
- `diagnosis_mirrors anon insert` / `INSERT` / `{anon}`
- `diagnosis_mirrors anon update` / `UPDATE` / `{anon}`

**SELECT / DELETE policy が出てきたら STOP**。

### 1.3 Trigger presence

```sql
SELECT tgname, tgrelid::regclass, tgtype
FROM pg_trigger
WHERE tgname = 'diagnosis_mirrors_set_updated_at';
```

期待: 1 行 / `tgrelid = diagnosis_mirrors`。

### 1.4 Column defaults

```sql
SELECT column_name, column_default, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'diagnosis_mirrors'
ORDER BY ordinal_position;
```

期待:
- `id` — `gen_random_uuid()` / NOT NULL / `uuid`
- `source_hash` — NOT NULL / `text` (+ UNIQUE)
- `schema_version` — NOT NULL / `text`
- `payload` — NOT NULL / `jsonb`
- `created_at` — `timezone('utc'::text, now())` / NOT NULL / `timestamp with time zone`
- `updated_at` — same

---

## 2. Mirror flow verification (apply 後 1〜6 時間)

### 2.1 First success row appears

```sql
SELECT count(*) AS n
FROM mirror_events
WHERE feature = 'diagnosis'
  AND mirror_status = 'success'
  AND created_at >= now() - interval '6 hours';
```

期待: `n > 0`。

**0 のまま 6 時間以上経過した場合**:
- 環境変数 `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` / `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` が ON になっていないか
- diagnosis form submit traffic があるか（小トラフィック feature のため、新規 user 0 だと success row も 0）
- `feature = 'diagnosis'` が `failure` / `skipped` / `disabled` に偏っていないか §2.2 で確認

### 2.2 Status distribution

```sql
SELECT
  mirror_status,
  count(*) AS n,
  ROUND(count(*)::numeric / SUM(count(*)) OVER (), 4) AS ratio
FROM mirror_events
WHERE feature = 'diagnosis'
  AND created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY 2 DESC;
```

期待ベースライン (apply 翌日):
- `success` — 主体
- `failure` — apply 直後のみ。継続的に増えるなら schema / RLS 異常
- `skipped` — production では 0
- `disabled` — 0（kill-switch 未使用前提）

### 2.3 Failure-reason distribution

```sql
SELECT failure_reason, count(*) AS n
FROM mirror_events
WHERE feature = 'diagnosis'
  AND mirror_status = 'failure'
  AND created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY 2 DESC;
```

期待:
- `network_error` — apply 直後の数件のみ
- `unknown` — 0 が理想。0.5% 以下が tolerable
- `missing_env` — production では 0
- `client_unavailable` — 0

### 2.4 Schema-version distribution

```sql
SELECT schema_version, count(*) AS n
FROM mirror_events
WHERE feature = 'diagnosis'
  AND created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY 1;
```

期待: `1` のみ。複数 version が混在していたら deploy lag を疑う。Phase1 後期に bump があれば一時的に v1/v2 混在が観測される（[`diagnosis_mirror_schema_preview.md §8`](./diagnosis_mirror_schema_preview.md) 参照）。

### 2.5 Environment split

```sql
SELECT environment, mirror_status, count(*) AS n
FROM mirror_events
WHERE feature = 'diagnosis'
  AND created_at >= now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY 1, 2;
```

production / preview / development の success 分布を確認。production 偏重 / preview 0 等の異常があれば deploy 経路を疑う。

---

## 3. Upsert idempotency verification (apply 後 24h 以内)

### 3.1 Retake dedup

```sql
SELECT source_hash, count(*) AS n_rows
FROM diagnosis_mirrors
GROUP BY source_hash
ORDER BY n_rows DESC
LIMIT 10;
```

期待: 全行で `n_rows = 1`（UNIQUE constraint より自明）。`updated_at - created_at > 0` が観測できれば idempotent retake が成立している。

### 3.2 Identical-answers handling

basicInfo precedent と同じ:
- 同 `(answers, resultType)` → 同 `source_hash` → 同 row update
- 異なる answers → 異なる `source_hash` → 新 row
- `createdAt` / `resultTitle` / `resultDescription` は hash 対象外なので dedup を妨げない

operator 確認の代替手段: `mirror_events.success` 件数 vs `diagnosis_mirrors` 件数の比較
```sql
SELECT
  (SELECT count(*) FROM mirror_events WHERE feature='diagnosis' AND mirror_status='success' AND created_at >= now() - interval '24 hours') AS success_events,
  (SELECT count(*) FROM diagnosis_mirrors WHERE updated_at >= now() - interval '24 hours') AS active_rows;
```

`success_events >= active_rows` が期待状態。

---

## 4. Rollback / kill-switch usage

### 4.1 環境変数による段階制御

| 状況 | 設定 | 影響範囲 |
|---|---|---|
| 全 mirror 緊急停止 | `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` | studentProfile + basicInfo + **diagnosis** すべて `mirror_events` に `disabled` として記録。upsert は実行されない |
| 観測 sink だけ停止 | `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED=true` | mirror upsert は継続。`mirror_events` への INSERT は silently skip |
| diagnosis だけ停止 | (Phase1 では未実装) | 必要になったら feature-specific kill-switch を `mirrorDiagnosis.ts` に追加 — `mirrorConfig.ts` global 経路は使わない |

### 4.2 Disable via env (Vercel)

basicInfo checklist §4.2 と同手順。同じ 2 環境変数。`NEXT_PUBLIC_*` は build-time inlining されるため **redeploy 必須**（env 変更だけでは反映されない）。新 deploy 取得後の page load から有効。stale client（モバイル tab / PWA cache）は新 deploy 取得まで旧挙動を継続する。詳細: [`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md)。

### 4.3 Schema-level rollback

| アクション | コマンド | 影響 |
|---|---|---|
| Table 撤去 | `DROP TABLE diagnosis_mirrors;` | mirror INSERT は `network_error` として silently 失敗。`mirror_events` 既存 row は保持。canonical (localStorage) 不変 |
| 全 row purge | `DELETE FROM diagnosis_mirrors;` | service-role 経由のみ。Phase1 anon は DELETE 不可 |
| Schema version migration 中の row 整理 | `DELETE FROM diagnosis_mirrors WHERE schema_version = '1';` | bump 後の clean restart 用。Phase1 後期で `QUESTIONS` 変更時の選択肢 |

---

## 5. 7-day soak observation

apply から 7 日後に再確認:

```sql
SELECT
  date_trunc('day', created_at) AS day,
  count(*) FILTER (WHERE mirror_status = 'success')::numeric
    / NULLIF(count(*), 0) AS success_rate,
  count(*) AS attempts
FROM mirror_events
WHERE feature = 'diagnosis'
  AND created_at >= now() - interval '7 days'
GROUP BY 1
ORDER BY 1;
```

graduation 暫定閾値:
- 7 日連続で daily `success_rate >= 0.95`
- `unknown` failure_reason 比率 < 1%
- `disabled` rows がゼロ
- `schema_version` 混在が無い（v1 のみ）

これらが満たされた時点で 3 mirror 体制が安定 production 化。次の feature mirror（matrix の order 3 以降 — `activityData` を候補とするが autosave-dedup が precursor STEP として必要）の着手判断材料とする。

---

## 6. When NOT to use this checklist

- 4th mirror（`activityData` 等）の着手判断 — [`feature_rollout_matrix.md`](./feature_rollout_matrix.md) §5 のルールで別途判断
- Phase1 → Phase2 移行判断 — [`migration_phases.md`](./migration_phases.md)
- Schema 進化（新 column 追加）の操作手順 — 別 schema STEP
- Retention 自動化 — Phase2 範囲
- Dashboard build — Phase1 では作らない方針（[`observability_sink.md §6.3`](./observability_sink.md)）

---

## 7. Sign-off

apply STEP は以下が満たされた時点で完了:

- [ ] §1.1〜§1.4 全項目 OK
- [ ] §2.1 で `success` row 出現を確認
- [ ] §2.2 で `failure` 比率が許容範囲（≦ 5%）かつ `disabled = 0`
- [ ] §2.3 で `unknown` 比率が許容範囲（< 1%）
- [ ] §2.4 で `schema_version` が `1` 単独
- [ ] §3.1 で UNIQUE constraint が機能
- [ ] §4.2 kill-switch 操作手順を operator runbook に追加（既存 runbook の追記で可）

未達項目があれば apply 完了とは扱わず、原因切り分けに戻る。
