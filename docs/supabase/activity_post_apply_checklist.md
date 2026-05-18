# activityData Mirror — Post-Apply Verification Checklist

`supabase/schema.sql` §13–§15（`activity_mirrors` テーブル + trigger + RLS）を Supabase project に apply した直後〜24h の確認項目。

basicInfo / diagnosis precedent と異なる verification:
- **Typing-only verification (§3.3) が必須** — submit-driven trigger contract が壊れていないかを確認
- PII spot-check は basicInfo の `name`-presence check と異なり、narrative content の長さ / 想定外フィールド混入を見る
- 7-day soak の信頼閾値は basicInfo / diagnosis と同じ

関連:
- [`activity_mirror_schema_preview.md`](./activity_mirror_schema_preview.md) — schema 設計 + narrative-soft PII contract
- [`basic_info_post_apply_checklist.md`](./basic_info_post_apply_checklist.md) — direct-PII checklist precedent
- [`diagnosis_post_apply_checklist.md`](./diagnosis_post_apply_checklist.md) — no-PII checklist precedent
- [`observability_sink.md`](./observability_sink.md)
- STEP-PHASE1M-ACTIVITY-MIRROR-TRIGGER-DECISION: submit-driven trigger contract

---

## 1. Immediate verification (apply 後 30 分以内)

### 1.1 Table existence + RLS state

```sql
SELECT
  relname,
  relrowsecurity AS rls_enabled,
  relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relname = 'activity_mirrors';
```

期待: 1 行 / `rls_enabled = true`。

### 1.2 Policy count

```sql
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'activity_mirrors'
ORDER BY policyname;
```

期待: 2 行のみ。
- `activity_mirrors anon insert` / `INSERT` / `{anon}`
- `activity_mirrors anon update` / `UPDATE` / `{anon}`

**SELECT / DELETE policy が出てきたら STOP**。

### 1.3 Trigger presence

```sql
SELECT tgname, tgrelid::regclass, tgtype
FROM pg_trigger
WHERE tgname = 'activity_mirrors_set_updated_at';
```

期待: 1 行 / `tgrelid = activity_mirrors`。

### 1.4 Column defaults

```sql
SELECT column_name, column_default, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'activity_mirrors'
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
WHERE feature = 'activityData'
  AND mirror_status = 'success'
  AND created_at >= now() - interval '6 hours';
```

期待: `n > 0`（最初の activity form submit から発火）。

**0 のまま 6 時間以上経過した場合**:
- 環境変数 `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` / `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED` が ON になっていないか
- production traffic に activity form submit があるか
- §3.3 の typing-only verification で trigger 配線が正しいか
- `feature = 'activityData'` が `failure` / `skipped` / `disabled` に偏っていないか §2.2 で確認

### 2.2 Status distribution

```sql
SELECT
  mirror_status,
  count(*) AS n,
  ROUND(count(*)::numeric / SUM(count(*)) OVER (), 4) AS ratio
FROM mirror_events
WHERE feature = 'activityData'
  AND created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY 2 DESC;
```

期待ベースライン:
- `success` — 主体
- `failure` — apply 直後の数件のみ
- `skipped` — production では 0
- `disabled` — 0

### 2.3 PII spot-check — narrative content sanity

basicInfo precedent の `payload ? 'name'` は適用不可（strip 対象 field 無し）。代わりに **narrative content の sanity** を確認する:

```sql
-- Unexpected fields の混入確認: activityData は 9 配列のみを top-level field として持つはず
SELECT id, jsonb_object_keys(payload) AS keys
FROM activity_mirrors
ORDER BY created_at DESC
LIMIT 20;
```

期待: keys は以下の 9 種のみ。
- `clubActivities` / `volunteerActivities` / `studyAbroadActivities` / `researchActivities` / `partTimeJobActivities` / `certificationActivities` / `contestActivities` / `readingActivities` / `hobbyActivities`

予期しない key (`email` / `phone` / `address` / `userId` / `auth` 等) が出たら **STOP** — payload 漏出。

```sql
-- 異常に長い narrative の検知（攻撃的 paste / system 文の混入検知）
SELECT id, length(payload::text) AS bytes
FROM activity_mirrors
WHERE length(payload::text) > 50000
ORDER BY bytes DESC
LIMIT 10;
```

期待: 0 行。50KB を超える activity payload はユーザ手入力では稀。出てきたら spot-check して legitimacy を operator が判断する。

### 2.4 Failure-reason distribution

```sql
SELECT failure_reason, count(*) AS n
FROM mirror_events
WHERE feature = 'activityData'
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

### 2.5 Schema-version distribution

```sql
SELECT schema_version, count(*) AS n
FROM mirror_events
WHERE feature = 'activityData'
  AND created_at >= now() - interval '24 hours'
GROUP BY 1
ORDER BY 1;
```

期待: `1` のみ。Phase1 中の bump が無い限り単一 version。

### 2.6 Environment split

```sql
SELECT environment, mirror_status, count(*) AS n
FROM mirror_events
WHERE feature = 'activityData'
  AND created_at >= now() - interval '24 hours'
GROUP BY 1, 2
ORDER BY 1, 2;
```

production / preview / development の success 分布を確認。

---

## 3. Trigger-contract verification (activityData-specific)

### 3.1 Mirror count vs submit count alignment

期待: activityData の daily mirror_events `success` count ≈ daily activity form submit count。

operator は production の活動整理 form 完了数を別経路（GA / Vercel Analytics / 内部 KPI）で取得し、比較する。±10% の誤差は許容（hydration retry / submit spam / mirror 失敗）。**>3× の乖離があれば trigger 配線異常**。

### 3.2 Mirror count vs basicInfo comparison

```sql
SELECT feature, count(*) AS daily_success
FROM mirror_events
WHERE mirror_status = 'success'
  AND created_at >= now() - interval '24 hours'
  AND feature IN ('basicInfo', 'activityData')
GROUP BY 1;
```

期待: activityData の count ≈ basicInfo の count（両方 form submit で 1 mirror）。同 user が両方を順番に submit するため。差が大きい場合:
- activityData ≫ basicInfo → activityData が autosave 経路に乗っている（重大 bug）
- activityData ≪ basicInfo → activityData submit 数が少ない（UX 課題、mirror 課題ではない）

### 3.3 Typing-only verification (重要)

submit-driven trigger contract の implementation verification。

**operator 手順:**

1. dev / preview / production のいずれか（traffic が把握できる環境）の `mirror_events` `feature='activityData' / mirror_status='success'` count を記録
   ```sql
   SELECT count(*) AS before_n FROM mirror_events
   WHERE feature='activityData' AND mirror_status='success';
   ```
2. ブラウザで `/input/activity` を開き、各 activity section に typing を行う（**submit ボタンは押さない**）
3. localStorage `activityFormData` が更新されていることを確認（autosave が canonical 経路で動いていること）
4. ブラウザを閉じる or `/home` に navigation して `/input/activity` から離脱
5. 1 と同じ query を再度実行し、count が **増えていない** ことを確認
   ```sql
   SELECT count(*) AS after_n FROM mirror_events
   WHERE feature='activityData' AND mirror_status='success';
   ```
6. `before_n === after_n` 期待

**increment が観測されたら STOP** — autosave 経路に mirror dispatch が混入している。`hooks/useActivityForm.ts` を検査し、submit handler 以外の場所からの mirror dispatch を除去。

### 3.4 Submit fires exactly once per submit verification

```sql
SELECT source_hash, count(*) AS attempts
FROM mirror_events
WHERE feature='activityData'
  AND mirror_status='success'
  AND created_at >= now() - interval '1 hour'
GROUP BY source_hash
HAVING count(*) > 1;
```

期待: 0 行（同一 hash の連続 success は再 submit を意味し、稀）。複数 attempt が頻発したら submit double-fire (handleSubmit が dual-invoke されている) を疑う。

---

## 4. Upsert idempotency verification (apply 後 24h 以内)

### 4.1 source_hash UNIQUE check

```sql
SELECT source_hash, count(*) AS n_rows
FROM activity_mirrors
GROUP BY source_hash
ORDER BY n_rows DESC
LIMIT 10;
```

期待: 全行で `n_rows = 1`（UNIQUE constraint より自明）。

### 4.2 Update vs insert ratio

```sql
SELECT
  (SELECT count(*) FROM mirror_events WHERE feature='activityData' AND mirror_status='success' AND created_at >= now() - interval '24 hours') AS success_events,
  (SELECT count(*) FROM activity_mirrors WHERE updated_at >= now() - interval '24 hours') AS active_rows;
```

`success_events >= active_rows` が期待。同 user が同内容で resubmit すると `success_events` が `active_rows` を超える。activityData の content variation は高いため、ratio はほぼ 1:1 になる見込み。

---

## 5. Rollback / kill-switch usage

### 5.1 環境変数による段階制御

basicInfo / diagnosis checklist と同じ 2 環境変数（`NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED` / `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED`）。effect は **4 mirror 全て** を対象。

**重要**: `NEXT_PUBLIC_*` は Next.js build 時に client bundle へ inlining されるため、env 変更だけでは反映されない。**redeploy 必須**（[`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md)）。stale client（モバイル tab / PWA cache）は新 deploy 取得まで旧挙動を継続する点も accept。activityData は submit-driven trigger のため、stale mobile tab が submit を行うまで mirror は発火しない（観測上 latency が長め）。

### 5.2 Schema-level rollback

| アクション | コマンド | 影響 |
|---|---|---|
| Table 撤去 | `DROP TABLE activity_mirrors;` | mirror INSERT は `network_error` として silently 失敗 |
| 全 row purge | `DELETE FROM activity_mirrors;` | service-role 経由のみ |
| 想定外 PII 検出時の selective purge | `DELETE FROM activity_mirrors WHERE id = '...';` | spot-check で異常 row が出た場合 |
| Length-based purge | `DELETE FROM activity_mirrors WHERE length(payload::text) > 50000;` | 攻撃的 paste の事後対処 |

---

## 6. 7-day soak observation

```sql
SELECT
  date_trunc('day', created_at) AS day,
  count(*) FILTER (WHERE mirror_status = 'success')::numeric
    / NULLIF(count(*), 0) AS success_rate,
  count(*) AS attempts
FROM mirror_events
WHERE feature = 'activityData'
  AND created_at >= now() - interval '7 days'
GROUP BY 1
ORDER BY 1;
```

graduation 閾値（basicInfo / diagnosis と同等）:
- 7 日連続で daily `success_rate >= 0.95`
- `unknown` failure_reason 比率 < 1%
- `disabled` rows がゼロ
- `schema_version` 混在無し

加えて activityData 固有の確認:
- `feature='activityData'` daily count が `feature='basicInfo'` daily count と同オーダー（form submit 経由のため）
- `typing-only verification` (§3.3) を 7 日後にもう一度実行し increment 無し

満たした時点で 4 mirror 体制が安定 production 化。次の mirror 候補（matrix 順位 5 以降）の着手判断材料とする — ただし narrative-soft PII 系 (selfPRs / essayPracticeReview / interview_records / statementReviewHistory) は別途 PII policy STEP が必要。

---

## 7. Sign-off

apply STEP は以下が満たされた時点で完了:

- [ ] §1.1〜§1.4 全項目 OK
- [ ] §2.1 で `success` row 出現を確認
- [ ] **§2.3 で予期しない top-level keys / 異常長 row の不在を確認**
- [ ] §2.4 で `unknown` 比率が許容範囲内
- [ ] **§3.3 typing-only verification で row 増分ゼロを確認 (submit-driven contract の verification)**
- [ ] §3.4 で submit double-fire 不在を確認
- [ ] §5.1 kill-switch 操作手順を operator runbook に統合
