# Phase1 basicInfo Mirror — Schema (Applied)

PASSAI Supabase Phase1 の **2nd feature mirror**（`basicInfo`）に対応する Supabase テーブル設計。

**Status: APPLIED in `supabase/schema.sql` §7–§9.** 設計フェーズの contract は本 doc が source of truth。Supabase project に対する実 apply（`SQL editor` / CLI 経由）は別 operational STEP であり、apply 前は mirror INSERT が PostgREST `{ error }` を返して `mirror_events` に `failure / network_error` を吐くだけで canonical UX は不変。apply 後の verification は [`basic_info_post_apply_checklist.md`](./basic_info_post_apply_checklist.md) を使用。

関連:
- [`mirror_observability.md`](./mirror_observability.md)
- [`observability_sink.md`](./observability_sink.md)
- [`feature_rollout_matrix.md`](./feature_rollout_matrix.md)
- [`schema_phase1_student_profile.md`](./schema_phase1_student_profile.md)
- 先行 mirror table: `student_profile_mirrors`（[`supabase/schema.sql §2`](../../supabase/schema.sql)）

---

## 1. Scope

- 対象: **`basic_info_mirrors` テーブル 1 つだけ**
- 用途: `lib/supabase/mirrorBasicInfo.ts` の upsert 先
- 範囲外: runtime helper（既に landed）/ Supabase project への実 apply 操作（operator 手動）/ dashboard / alerting / Phase2 認証統合

本 doc は schema の design rationale + PII contract + verification 手順を 1 箇所にまとめる。実 DDL は `supabase/schema.sql` §7–§9 が source of truth。両者の文言は drift しないよう、PR レビュー時に対照確認する。

---

## 2. Planned Table

```sql
CREATE TABLE basic_info_mirrors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash     text        NOT NULL UNIQUE,
  schema_version  text        NOT NULL,
  payload         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE basic_info_mirrors IS
  'Phase1 best-effort mirror sink for basicInfo. localStorage is canonical. '
  'No SELECT policy by design — see docs/supabase/basic_info_mirror_schema_preview.md. '
  'PII rule: payload MUST NOT contain `name`; mirror helper strips it before INSERT.';

COMMENT ON COLUMN basic_info_mirrors.source_hash IS
  'sha256(JSON.stringify(payloadWithoutName) + schema_version). '
  'Computed by lib/supabase/mirrorBasicInfo.ts at write time; NOT present on '
  'the canonical type. Upsert conflict target.';

COMMENT ON COLUMN basic_info_mirrors.schema_version IS
  'basicInfo canonical shape version. Pinned to "1" at first apply. '
  'Bump when normalizeBasicInfo / pruneSubjectGrades change post-prune shape.';

COMMENT ON COLUMN basic_info_mirrors.payload IS
  'Opaque jsonb snapshot of post-prune BasicInfo MINUS `name`. '
  'Phase1 has no query requirements; structured-column expansion is '
  'deferred to a later STEP. PII guarantee: name is stripped by the '
  'mirror helper; raw user-supplied name never leaves the browser.';
```

Shape は `student_profile_mirrors` と完全に揃える（`source_hash` / `schema_version` / `payload` / `created_at` / `updated_at`）。**カラム差分はゼロ。**`<feature>_mirrors` の命名 + jsonb payload + sha256 conflict key を Phase1 mirror table の reference template として固定する。

---

## 3. Trigger

`student_profile_mirrors` と共有する `set_updated_at()` trigger 関数を再利用する。新しい関数は作らない。

```sql
CREATE TRIGGER basic_info_mirrors_set_updated_at
  BEFORE UPDATE ON basic_info_mirrors
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

trigger 関数は `supabase/schema.sql §3` で既に定義済み。apply STEP では trigger declaration のみ追加する。

---

## 4. RLS — write-only for anon

```sql
ALTER TABLE basic_info_mirrors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "basic_info_mirrors anon insert"
  ON basic_info_mirrors
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "basic_info_mirrors anon update"
  ON basic_info_mirrors
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
```

設計意図:

- **INSERT + UPDATE** は upsert (`INSERT ... ON CONFLICT DO UPDATE`) のため両方必要。`student_profile_mirrors` と同 posture。
- **SELECT policy 無し** — client から basicInfo 内容を読める経路を作らない。
- **DELETE policy 無し** — rollback / retention は service-role 経由の SQL editor 操作に閉じる。
- 認証は Phase2 で導入。user-scoped RLS は本 doc の範囲外。

---

## 5. Upsert semantics

| 質問 | 回答 |
|---|---|
| upsert vs append | **upsert** — basicInfo は current-state、log ではない |
| conflict key | `source_hash` — content-derived、`student_profile_mirrors` precedent と一致 |
| idempotency expectation | 高 — 同一 input → 同一 source_hash → row 更新のみ |
| replay tolerance | 高 — 再 mirror は `updated_at` 変化として観測されるのみ |
| duplicate tolerance | Phase1 では中 — 2 anonymous users が同一 basicInfo 内容を持つと collide。`user_id` 列が無い Phase1 で許容するトレードオフ。Phase2 認証導入時に additive 解決 |
| stale overwrite risk | 中 — multi-tab race は canonical で先に解決し、mirror は最終 canonical 状態を映す。`mirror_events.created_at` で attempt 履歴は保持 |
| partial-write risk | 低 — `pruneSubjectGrades` が caller 側で同期実行済み、mirror は post-prune shape を受ける |

---

## 6. PII contract

### 6.1 `name` を含めない

`BasicInfo.name` は user-supplied 自由記述 (実名 or ニックネーム)。Phase1 anonymous の前提下では、raw user-supplied name を **mirror 経路で browser から出さない** ことを契約とする。

実装側の保証:
- `lib/supabase/mirrorBasicInfo.ts::stripName()` が upsert 直前に `name` を削除
- type 経路ではなく **runtime に閉じる削除** — caller が strongly-typed BasicInfo を渡しても、mirror payload は確実に `name` を含まない
- `source_hash` の計算も `payloadWithoutName` 基準。`name` は hash 入力にも入らない

### 6.2 残る field の re-identification 評価

`name` を削除した後でも、以下の組み合わせは theoretical な re-identification risk を持つ:

- `preferences[].university + faculty + department`（特に rare 校）
- `grade + track + overallGpa + subjectGrades` の精細値

これらは Phase1 では**許容**する。理由:

1. operator は service-role 経由でのみ SELECT 可能 (anon SELECT policy 無し)
2. `student_profile_mirrors` も同等の indirect-PII を含む (AI synthesis 由来) → 既存と同 posture
3. Phase1 は **anonymous 完動** 前提であり、user_id がない以上 cross-row linkage が成立しない

Phase2 で auth + `user_id` 列が入る時点で改めて評価する。

### 6.3 `source_hash` の PII 性

`source_hash = sha256(JSON.stringify(payloadWithoutName) + "1")`。

- preimage attack は計算量的に不可能 (SHA-256)
- ただし low-entropy input (e.g. `name` 抜きで `grade = "高2"`, `track = "文系"`, `preferences = []`, `examTypes = []` のような empty form) では、dictionary attack で payload を逆引きされる可能性は理論上残る
- Phase1 では許容: source_hash は anon SELECT で取れず、operator は service-role 経由のみ。dictionary attack のための query path が無い
- mitigation を入れるなら Phase2 で salt 列 (operator-managed secret) を additive に追加する

---

## 7. sourceHash rationale

basicInfo の canonical 型 `BasicInfo` には `sourceHash` field が **存在しない**。studentProfile は `lib/studentProfile.ts::toStudentProfile()` が hash を埋める設計だが、basicInfo の canonical artifact は form 入力そのものであり、hash を canonical 化する正当な理由が無い。

選択肢の比較:

| 案 | 影響 | 採否 |
|---|---|---|
| `BasicInfo.sourceHash` を追加 | 8 readers + `lib/aiInputHash.ts` に波及。hash 変動で 5 AI cache がすべて miss | **却下** |
| canonical helper (`saveBasicInfo`) が hash を引数受け取り | caller (page.tsx) が hash 計算ロジックを持つ。feature → infra 漏洩 | **却下** |
| mirror helper 内で derive (現案) | mirror-local concern。canonical 型・8 readers・AI hash すべて不変 | **採用** |

実装は `lib/supabase/mirrorSourceHash.ts::sha256Hex()` 経由で `crypto.subtle.digest('SHA-256', ...)` を使用（N=3 で `mirrorDiagnosis` と共有抽出済）。browser 専用 API だが、mirror helper は元々 `typeof window === "undefined"` で early return するため非 browser 経路はない。

---

## 8. Apply order (operational — for Supabase project)

`supabase/schema.sql` §7–§9 の DDL を Supabase project へ反映する手順。runtime 側はすでに wired 済みなので、apply の前後で canonical UX は変わらない。

### 8.1 Apply sequence

1. `supabase/schema.sql` の §7 / §8 / §9 セクションのみを Supabase SQL editor / `supabase db push` で apply（他 section は既存 table が存在するため idempotent でない —必ず差分セクションだけ実行する）
2. Supabase dashboard で目視確認:
   - `basic_info_mirrors` table が表示される
   - **Row Level Security**: `Enabled`
   - **Policies**: 2 件のみ（`basic_info_mirrors anon insert` + `basic_info_mirrors anon update`）
   - SELECT / DELETE policy が **無い** こと
   - `created_at` / `updated_at` の default 式が `timezone('utc', now())` であること
   - `basic_info_mirrors_set_updated_at` trigger が `BEFORE UPDATE` で存在すること
3. [`basic_info_post_apply_checklist.md`](./basic_info_post_apply_checklist.md) の checklist を順に実行

### 8.2 Pending verification (24h window post-apply)

apply 直後の確認項目は [`basic_info_post_apply_checklist.md`](./basic_info_post_apply_checklist.md) に集約。本 doc では概要のみ:

- `mirror_events` に `feature = 'basicInfo' / mirror_status = 'success'` rows が >0 件
- 任意 `basic_info_mirrors.payload` row に `name` field が **存在しない**（PII spot-check）
- `feature = 'basicInfo' / mirror_status = 'failure'` rows の `failure_reason` 分布が `network_error` 偏重でない（apply 直後の数件は許容、その後は減衰）
- `feature = 'basicInfo' / mirror_status = 'disabled'` rows が production で 0（kill-switch 不使用）

### 8.3 Rollback strategy

問題発覚時:

| トリガ | アクション |
|---|---|
| 急ぎで止めたい (UX 影響なし) | 環境変数 `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` を設定 → **redeploy** で **両 mirror** 一括停止。`NEXT_PUBLIC_*` は build-time inlining されるため env 変更だけでは反映されない（[`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md) 参照）。stale client（モバイル tab / PWA cache）は新 deploy 取得まで旧挙動を継続する |
| 観測 sink だけ止めたい | `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED=true`。mirror upsert は続くが `mirror_events` には書き込まれない |
| schema 自体を撤去 | `DROP TABLE basic_info_mirrors;` 単独で完結（FK 無し / 他 table 依存無し / `mirror_events` は別 table）。撤去後の mirror INSERT は `network_error` として silently 失敗。runtime にも canonical UX にも一切影響なし |
| PII 漏洩疑い | (a) kill-switch ON → (b) service-role 経由で `DELETE FROM basic_info_mirrors;` → (c) mirror helper の `stripName` ロジック検証 → (d) 検証後に kill-switch OFF。`mirror_events` 側の row は PII を含まないため purge 不要 |

rollback で破棄した row は復元しない。canonical (localStorage) が source of truth として残るため、user data 自体は失われない。

---

## 9. What this doc deliberately defers

- **`payload` 列の structured 化**: 列展開は schema migration 必須。Phase1 では jsonb dump で十分。query 要件が発生した時点で別 STEP
- **`user_id` 列**: Phase2 認証導入と同時に additive 追加
- **retention 自動化**: `pg_cron` 等は Phase2 で
- **salt 列 (preimage 防御)**: §6.3 の Phase2 評価で改めて
- **`prompt_version` / `cache_version` 列**: basicInfo は AI 出力 artifact ではないため対象外。記録のため明示

---

## 10. Acceptance criteria for the apply STEP

apply STEP の PR で確認:

1. `supabase/schema.sql` に §2 / §3 / §4 の DDL が追加されている
2. 既存 `student_profile_mirrors` の DDL は不変
3. `mirror_events` schema は不変
4. apply 後 24h 以内に `mirror_events` で `feature = "basicInfo" / mirrorStatus = "success"` が >0 件
5. canonical UX は不変 (apply 前後で `app/input/basic/page.tsx` の挙動・hydration・AI cache に変化なし)
6. PII spot-check: 任意 `basic_info_mirrors.payload` row に `name` field が **存在しない**
