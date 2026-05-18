# Phase1 activityData Mirror — Schema (Applied)

PASSAI Supabase Phase1 の **4th feature mirror**（`activityData`）に対応する Supabase テーブル設計。

**Status: APPLIED in `supabase/schema.sql` §13–§15.** runtime helper（`lib/supabase/mirrorActivityData.ts`）は landed 済。Supabase project に対する実 apply（SQL editor / CLI 経由）は別 operational STEP であり、apply 前は mirror INSERT が PostgREST `{ error }` を返して `mirror_events` に `failure / network_error` を吐くだけで canonical UX は不変。apply 後の verification は [`activity_post_apply_checklist.md`](./activity_post_apply_checklist.md) を使用（§3.3 typing-only verification が submit-driven contract の implementation 検証として critical）。

関連:
- [`basic_info_mirror_schema_preview.md`](./basic_info_mirror_schema_preview.md) — direct-PII strip precedent (2nd mirror)
- [`diagnosis_mirror_schema_preview.md`](./diagnosis_mirror_schema_preview.md) — no-PII precedent (3rd mirror)
- [`schema_phase1_student_profile.md`](./schema_phase1_student_profile.md) — 1st mirror precedent
- [`observability_sink.md`](./observability_sink.md)
- [`feature_rollout_matrix.md`](./feature_rollout_matrix.md)
- [`mirror_observability.md`](./mirror_observability.md)
- STEP-PHASE1M-ACTIVITY-MIRROR-TRIGGER-DECISION: submit-driven trigger contract

---

## 1. Scope

- 対象: **`activity_mirrors` テーブル 1 つだけ**
- 用途: `lib/supabase/mirrorActivityData.ts` の upsert 先（`hooks/useActivityForm.ts:handleSubmit` から fire-and-forget 1 回呼び出し）
- 範囲外: runtime helper（landed）/ Supabase project への実 apply / dashboard / Phase2 認証統合

---

## 2. Planned Table

```sql
CREATE TABLE activity_mirrors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash     text        NOT NULL UNIQUE,
  schema_version  text        NOT NULL,
  payload         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE activity_mirrors IS
  'Phase1 best-effort mirror sink for activityData (活動整理). localStorage '
  'is canonical. No SELECT policy by design. Payload carries no direct-name '
  'PII (no `name`-equivalent field) but DOES carry user-authored narrative '
  'free text (clubName / activityContent / theme / description / achievement '
  '/ role / challenge / action / reflection / futureConnection, etc.). '
  'Operator sign-off on the Phase1 anonymous-RLS exposure of these '
  'narratives is the gate that lets this table exist. '
  'See docs/supabase/activity_mirror_schema_preview.md §6.';

COMMENT ON COLUMN activity_mirrors.source_hash IS
  'sha256(JSON.stringify(payload) + schema_version). Computed by '
  'lib/supabase/mirrorActivityData.ts at write time over the FULL payload '
  '(unlike basic_info_mirrors which strips `name` first). Upsert conflict '
  'target. No fields are excluded from canonical identity; any change to '
  'any of the 9 activity arrays or any nested string is a content change.';

COMMENT ON COLUMN activity_mirrors.schema_version IS
  'activityData canonical shape version. Pinned to "1" at first apply. '
  'Bump triggers: adding/removing/renaming any of the 9 top-level arrays, '
  'any BaseActivity field, or any feature-specific Activity type field. '
  'Validator changes (lib/activityValidator.ts) do NOT trigger a bump.';

COMMENT ON COLUMN activity_mirrors.payload IS
  'Opaque jsonb snapshot of the post-validate ActivityData (9 top-level '
  'arrays, each with feature-specific shape). Stored verbatim — no strip, '
  'no normalize, no sort. Shape MUST match what lib/aiInputHash.ts consumes '
  'to keep AI cache hashes stable across canonical and mirror.';
```

カラム shape は `student_profile_mirrors` / `basic_info_mirrors` / `diagnosis_mirrors` と完全に揃える。`<feature>_mirrors` の命名 + jsonb payload + sha256 conflict key を 4 feature 共通の Phase1 mirror reference template として固定する。

---

## 3. Trigger

`set_updated_at()` trigger 関数を 3 共有先と同様に再利用。

```sql
CREATE TRIGGER activity_mirrors_set_updated_at
  BEFORE UPDATE ON activity_mirrors
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

---

## 4. RLS — write-only for anon

```sql
ALTER TABLE activity_mirrors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_mirrors anon insert"
  ON activity_mirrors
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "activity_mirrors anon update"
  ON activity_mirrors
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);
```

設計意図は他 3 mirror table と同 posture。SELECT / DELETE policy は意図的に存在しない。

---

## 5. Upsert semantics

| 質問 | 回答 |
|---|---|
| upsert vs append | **upsert** — activityData は current-state、log ではない |
| conflict key | `source_hash` — content-derived（full payload + schema_version） |
| idempotency expectation | 中 — 同一 payload → 同一 hash → row 更新のみ。ただし narrative content は keystroke 単位で変化するため、同一 source_hash の再 submit は実用上稀 |
| trigger source | **`hooks/useActivityForm.ts:handleSubmit` のみ**。autosave 経路 (`saveActivityData` in `lib/activityStorage.ts`) には mirror dispatch を入れない |
| expected save rate | 1 mirror call / form submit。autosave (1000-5000 / session) ではない |
| stale overwrite risk | 中 — multi-tab submit race は canonical で先に解決、mirror は両 submit の rows を持つ |
| partial-write risk | 低 — submit handler は `validateActivityForm` 通過後にのみ mirror dispatch |

---

## 6. PII contract — narrative-soft PII

### 6.1 Direct-PII field の有無

`ActivityData` の 9 top-level arrays とそのフィールドを通覧した結果:

| カテゴリ | 直接 PII fieldの有無 |
|---|---|
| `clubActivities` / `volunteerActivities` / `studyAbroadActivities` / `researchActivities` / `partTimeJobActivities` / `contestActivities` (6 categories sharing `BaseActivity`) | **無し** — `name` / `email` / `phone` 相当のフィールド無し |
| `certificationActivities` | **無し** |
| `readingActivities` | **無し** |
| `hobbyActivities` | **無し** |

→ basicInfo precedent の `stripName` 相当の boundary 内ガードは activityData には**存在しない**。strip 可能な direct-PII field が無いため。

### 6.2 Narrative-soft PII の存在

ただし、以下の free-text フィールド群は **narrative-soft PII** を保持する:

- `clubName` / `sport` / `competitionLevel` — 特定の部活動・大会名
- `activityContent` / `target` / `purpose` / `frequency` — ボランティア内容
- `destination` / `programContent` / `language` — 留学先国・プログラム
- `theme` / `trigger` / `hypothesis` / `methodology` / `output` — 探究テーマ
- `industry` / `jobContent` / `workFrequency` — アルバイト先業種
- `certificationName` / `level` / `acquiredDate` — 資格名・取得時期
- `contestName` / `field` / `result` — コンテスト名・成績
- `favoriteBook` / `genre` — 読書履歴
- `hobbyContent` — 趣味内容
- 6 categories で共通の `description` / `achievement` / `role` / `challenge` / `action` / `reflection` / `futureConnection` — ユーザーが自分の言葉で書いた narrative

これらの distinction:

- **basicInfo**: 直接 PII (`name`) を strip すれば PII 上は無害化可能
- **diagnosis**: 自由記述ゼロ — strip 不要
- **activityData**: narrative IS the artifact。strip すれば mirror が無意味になる

### 6.3 Phase1 anonymous posture との整合

operator が以下を許容することが本 mirror の前提条件:

1. service-role 経由でのみ SELECT 可能 (anon SELECT policy 無し)
2. 個別 row は narrative content を verbatim 保持
3. cross-row linkage は anonymous Phase1 では成立しない (`user_id` 列無し)
4. 単一 row 単独では特定大学/部活/コンテストとの組み合わせから re-identification 可能性がある (rare 大学 × specific 大会 × specific 学年 のような combination)

これは `basic_info_mirrors` で許容している school 名の保持と同等の posture。activityData は narrative field の数が多いため "surface area" は大きいが、attack model (operator-only SELECT) は同じ。

Phase2 + auth + `user_id` 導入時に改めて評価する。

### 6.4 Re-identification mitigation の Phase1 限界

以下は **Phase1 では適用しない**:

- narrative の自動 redaction / anonymization（precedent 無し / 検証コスト大）
- 特定キーワード (大学名・人名) の filter list（false negative 多すぎる）
- field-level encryption（service-role でも読めなくなる → operational query 不能）
- salt 付き hash で source_hash を不可逆化（dedup が壊れる）

Phase2 で auth が入った時点で、`user_id`-scoped SELECT policy を入れて操作者の visibility を制限する経路で改善する想定。

### 6.5 PII spot-check の方針

basicInfo checklist で行った `payload ? 'name'` チェックの直接的な applic は無い（strip 対象 field が無い）。代わりに operator は post-apply に以下を spot-check:

1. payload に予期しない field（`email` / `phone` / `address` 等）が混入していないか
2. narrative field の length が異常に長くないか（攻撃的 paste の検知）
3. 既知の禁止語（社外秘 / personal contact）が混入していないか

具体 query は [`activity_post_apply_checklist.md §2.3`](./activity_post_apply_checklist.md) で定義。

---

## 7. sourceHash rationale

`ActivityData` には canonical に sourceHash field は **存在しない**。`mirrorActivityData.ts` が write 時に derive する。

選択肢比較:

| 案 | 影響 | 採否 |
|---|---|---|
| `ActivityData.sourceHash` を追加 | 6+ consumers + `lib/aiInputHash.ts` (5 sites) に波及。AI cache hash が flip して既存ユーザの cache miss を引き起こす | **却下** |
| canonical helper (`saveActivityData`) が hash を引数受け取り | autosave 経路で hash 計算が走り CPU 浪費。caller (hook) が hash logic を持つ | **却下** |
| mirror helper 内で derive (現案) | mirror-local concern。canonical 型・consumer・AI hash すべて不変 | **採用** |

実装は `lib/supabase/mirrorSourceHash.ts::sha256Hex()` 経由（3 mirror で shared）。browser 専用 API。

### 7.1 Hash input の選定

```
source_hash = sha256(
  JSON.stringify(payload) + SCHEMA_VERSION
)
```

basicInfo / diagnosis と異なり、**全 field を hash 対象に含める**:

| Field 群 | Hash に含む? | 理由 |
|---|---|---|
| `clubActivities` 〜 `hobbyActivities` の各 array | **YES** | activityData の content identity 本体 |
| array 内の各 string field | **YES** | narrative content の同一性が hash 同一性 |
| array 内の各 `period` nested object | **YES** | 期間情報も content identity の一部 |

basicInfo は `name` を hash 対象外にしていたが、activityData には除外候補が無い。**全 raw payload を hash する**。

---

## 8. Trigger contract — submit-driven (NEVER autosave-driven)

STEP-PHASE1M で確定:

| 項目 | 採用案 | 却下案 |
|---|---|---|
| Trigger location | `hooks/useActivityForm.ts:handleSubmit` の `try { sessionStorage.setItem(...); ... }` 内 | `lib/activityStorage.ts:saveActivityData` (autosave path) |
| Expected fire rate | 1 / form submit (≈ 1-3 / session) | 1000-5000 / session (per keystroke) |
| Canonical-write-then-mirror invariant | 保持 (`sessionStorage.setItem` 成功後に dispatch) | 弱化 (autosave のたびに schedule) |
| async timer state | 無し | 必要 (debounce / cancel) |
| mirror_events signal/noise | 高（row = intent） | 低（row = pause / noise mixed） |

mirror dispatch は `validateActivityForm` を通過し、`sessionStorage.setItem` も成功した直後に fire-and-forget で 1 回呼ばれる。`await` しない / canonical UX を妨げない。

---

## 9. SCHEMA_VERSION bump triggers (documented contract)

Bump 必須:

1. `ActivityData` 型の 9 top-level array の **追加 / 削除 / 改名**
2. `BaseActivity` shape の **追加 / 削除 / 改名**（6 共有 type に波及）
3. `XxxActivity` 個別 type のフィールド **追加 / 削除 / 改名**
4. activity `type` discriminator の値変更（'club' / 'volunteer' / ... の文字列）
5. `period.from` / `period.to` の型変更

Bump 不要:

- `lib/activityValidator.ts` の validation rule 変更（presentation-layer）
- `lib/activityFactories.ts` のフィールド default 値変更（empty string のままなら）
- UI 文言 / placeholder / label 変更
- `useActivityForm.ts` 内部 helper 関数のリファクタリング

---

## 10. What this doc deliberately defers

- **`payload` 列の structured 化**: jsonb dump で Phase1 十分。9 array × N field の structured column は schema migration コスト高
- **`user_id` 列**: Phase2 認証導入と同時に additive 追加
- **retention 自動化**: `pg_cron` 等は Phase2
- **PII redaction layer**: §6.4 参照 — Phase2 で auth-scoped policy に投資する方が妥当
- **per-array sub-table 化**: `activity_mirrors_clubs` / `_volunteers` 等の細分割は Phase2 で query 要件が固まってから判断

---

## 11. Acceptance criteria for the apply STEP

apply STEP（`supabase/schema.sql` §13–§15 追加 + Supabase project apply）の PR で確認:

1. `supabase/schema.sql` に §13 (CREATE TABLE + COMMENT) / §14 (TRIGGER) / §15 (RLS + 2 policies) が追加されている
2. 既存 `student_profile_mirrors` / `basic_info_mirrors` / `diagnosis_mirrors` / `mirror_events` の DDL は不変
3. apply 後 24h 以内に `mirror_events` で `feature = "activityData" / mirrorStatus = "success"` が >0 件
4. canonical UX は不変 (apply 前後で `app/input/activity/page.tsx` の挙動・autosave 頻度・AI hash に変化なし)
5. **Typing-only verification**: form を開いて typing するだけで submit しないユーザに対して `activity_mirrors` / `mirror_events.feature='activityData'` の row が増えないこと (submit-driven trigger の implementation verification)
6. PII spot-check は §6.5 で定義したパターン

---

## 12. Rollback strategy

| トリガ | アクション |
|---|---|
| 急ぎで止めたい | 環境変数 `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` を設定 → **redeploy** で **4 mirror 全て一括停止**。`NEXT_PUBLIC_*` は build-time inlining されるため env 変更だけでは反映されない（[`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md) 参照）。stale client（モバイル tab / PWA cache）は新 deploy 取得まで旧挙動を継続する点も accept |
| 観測 sink だけ止めたい | `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED=true`。mirror upsert は続くが `mirror_events` には書き込まれない |
| schema 自体を撤去 | `DROP TABLE activity_mirrors;` 単独で完結（FK 無し / 他 table 依存無し）。撤去後の mirror INSERT は `network_error` として silently 失敗。runtime / canonical UX に一切影響なし |
| PII 漏洩疑い | (a) kill-switch ON → (b) service-role 経由で `DELETE FROM activity_mirrors;` → (c) 該当 narrative source の確認 → (d) operator 判断で kill-switch OFF |
| narrative content が想定外に長い | service-role 経由で `DELETE FROM activity_mirrors WHERE jsonb_size(payload::text) > N;` でクリーニング |

rollback で破棄した row は復元しない。canonical (localStorage) が source of truth として残るため、user data は失われない。
