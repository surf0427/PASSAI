# Phase1 diagnosis Mirror — Schema (Applied)

PASSAI Supabase Phase1 の **3rd feature mirror**（`diagnosis`）に対応する Supabase テーブル設計。

**Status: APPLIED in `supabase/schema.sql` §10–§12.** runtime helper（`lib/supabase/mirrorDiagnosis.ts`）は landed 済。Supabase project に対する実 apply（SQL editor / CLI 経由）は別 operational STEP であり、apply 前は mirror INSERT が PostgREST `{ error }` を返して `mirror_events` に `failure / network_error` を吐くだけで canonical UX は不変。apply 後の verification は [`diagnosis_post_apply_checklist.md`](./diagnosis_post_apply_checklist.md) を使用。

関連:
- [`mirror_observability.md`](./mirror_observability.md)
- [`observability_sink.md`](./observability_sink.md)
- [`feature_rollout_matrix.md`](./feature_rollout_matrix.md)
- [`basic_info_mirror_schema_preview.md`](./basic_info_mirror_schema_preview.md) — 2nd mirror precedent
- [`schema_phase1_student_profile.md`](./schema_phase1_student_profile.md) — 1st mirror precedent

---

## 1. Scope

- 対象: **`diagnosis_mirrors` テーブル 1 つだけ**
- 用途: `lib/supabase/mirrorDiagnosis.ts` の upsert 先
- 範囲外: runtime helper（既に landed）/ Supabase project への実 apply 操作（operator 手動）/ dashboard / alerting / Phase2 認証統合

本 doc は schema の design rationale + sourceHash contract + verification 手順を 1 箇所にまとめる。実 DDL は `supabase/schema.sql` §10–§12 が source of truth（別 STEP で追加）。両者の文言は drift しないよう、PR レビュー時に対照確認する。

---

## 2. Planned Table

```sql
CREATE TABLE diagnosis_mirrors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash     text        NOT NULL UNIQUE,
  schema_version  text        NOT NULL,
  payload         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE diagnosis_mirrors IS
  'Phase1 best-effort mirror sink for diagnosis (受験タイプ診断). '
  'localStorage is canonical. No SELECT policy by design. '
  'Payload carries NO user free-text — answers are numeric indices into '
  'QUESTIONS option arrays; resultType is a fixed enum; resultTitle and '
  'resultDescription are app-supplied static strings. No PII strip is '
  'required at the mirror layer. See '
  'docs/supabase/diagnosis_mirror_schema_preview.md.';

COMMENT ON COLUMN diagnosis_mirrors.source_hash IS
  'sha256(JSON.stringify({ answers, resultType }) + schema_version). '
  'Computed by lib/supabase/mirrorDiagnosis.ts at write time; NOT present on '
  'the canonical DiagnosisResult type. Upsert conflict target. '
  'createdAt / resultTitle / resultDescription are intentionally excluded '
  'from the hash so identical retakes dedup and app-supplied copy edits do '
  'not force schema_version bumps.';

COMMENT ON COLUMN diagnosis_mirrors.schema_version IS
  'diagnosis canonical shape version. Pinned to "1" at first apply. '
  'Bump triggers: QUESTIONS array changes (length / option order), '
  'DiagnosisType enum extends, or calcResultType logic changes. Title / '
  'description copy edits do NOT trigger a bump.';

COMMENT ON COLUMN diagnosis_mirrors.payload IS
  'Opaque jsonb snapshot of DiagnosisResult { resultType, resultTitle, '
  'resultDescription, answers, createdAt }. Stored verbatim — no strip, no '
  'normalize. App-authored title/description are durable historical '
  'snapshots and may differ from the current in-code RESULT_TYPES.';
```

カラム shape は `student_profile_mirrors` / `basic_info_mirrors` と完全に揃える（`source_hash` / `schema_version` / `payload` / `created_at` / `updated_at`）。**`<feature>_mirrors` の命名 + jsonb payload + sha256 conflict key** が 3 feature 共通の Phase1 mirror reference template として固定される。

---

## 3. Trigger

`student_profile_mirrors` / `basic_info_mirrors` と共有する `set_updated_at()` trigger 関数を再利用する。

```sql
CREATE TRIGGER diagnosis_mirrors_set_updated_at
  BEFORE UPDATE ON diagnosis_mirrors
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

新しい trigger function は作らない。apply STEP では trigger declaration のみ追加する。

---

## 4. RLS — write-only for anon

```sql
ALTER TABLE diagnosis_mirrors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "diagnosis_mirrors anon insert"
  ON diagnosis_mirrors
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "diagnosis_mirrors anon update"
  ON diagnosis_mirrors
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
```

設計意図は basicInfo / studentProfile と同 posture:

- **INSERT + UPDATE** は upsert (`INSERT ... ON CONFLICT DO UPDATE`) のため両方必要
- **SELECT policy 無し** — client から diagnosis 結果を読める経路を作らない
- **DELETE policy 無し** — rollback / retention は service-role 経由

認証 / `user_id` 列は Phase2 範囲。

---

## 5. Upsert semantics

| 質問 | 回答 |
|---|---|
| upsert vs append | **upsert** — diagnosis は current-state（最新の resultType）、log ではない |
| conflict key | `source_hash` — content-derived（`{ answers, resultType }` based） |
| idempotency expectation | 高 — 同一 answers + 同一 resultType → 同一 hash → row 更新のみ |
| replay tolerance | 高 — 再 mirror は `updated_at` 変化として観測されるのみ |
| retake with identical answers | 同 hash → upsert UPDATE 経路。新 row 作成なし。`mirror_events` には新 attempt event |
| retake with different answers | 異なる hash → 新 row INSERT。canonical は最新だけ保持、mirror は両方保持（content-history） |
| duplicate tolerance | Phase1 では中 — 2 anonymous users が同一 answers を選んだら collide。Phase2 `user_id` で additive 解決 |
| stale overwrite risk | 中 — multi-tab race は canonical が最新を保持、mirror は両 attempt を rows として持つ |
| partial-write risk | 低 — `saveDiagnosisResult` は同期 1 件 write |

---

## 6. PII contract

### 6.1 Payload に user 自由記述は **無い**

`DiagnosisResult` の各 field:

| Field | 由来 | PII 性 |
|---|---|---|
| `answers: number[]` | user の選択肢 index | **無い** — 5 つの numeric index のみ |
| `resultType: 1\|2\|3\|4` | `calcResultType(answers)` の決定的出力 | **無い** — 固定 enum |
| `resultTitle: string` | `RESULT_TYPES[resultType].title` (in-code static dictionary) | **無い** — app-authored |
| `resultDescription: string` | `RESULT_TYPES[resultType].description` (in-code static dictionary) | **無い** — app-authored |
| `createdAt: ISO string` | `new Date().toISOString()` at save | **無い** — timestamp |

→ **strip layer 不要**。`mirrorBasicInfo` の `stripName` 相当の boundary 内ガードは diagnosis では存在しない（必要が無いから作らない）。

### 6.2 Re-identification risk

`(answers, resultType, createdAt)` の組み合わせは:

- `answers` の組み合わせ数は QUESTIONS の option 数の積（≦ 4^5 = 1024 ≦ 数百〜千の order）
- 大量の anonymous user 母集団下では re-identification 困難（同 answers 組合せの user が多数発生）
- service-role 経由読み取りのみ。anon SELECT policy 無し

Phase1 anonymous posture との整合: **問題なし**。

### 6.3 Title / description の app-authored 性質

`resultTitle` / `resultDescription` は `app/diagnosis/page.tsx` の `RESULT_TYPES` 定数辞書に存在するため、**user data ではない**。これらが mirror に書かれることに PII 上の懸念は無い。ただし操作者には、「**保存されている title/description は保存当時の copy**」であって現在の in-code 辞書とは必ずしも一致しない、という durable-snapshot 性質を周知する必要がある。

---

## 7. sourceHash rationale

`DiagnosisResult` には canonical に sourceHash field は **存在しない**。`mirrorDiagnosis.ts` が write 時に derive する。

選択肢比較:

| 案 | 影響 | 採否 |
|---|---|---|
| `DiagnosisResult.sourceHash` を追加 | 1 consumer (`DiagnosisTypeCard`) に波及。`lib/aiInputHash.ts` には影響なし（diagnosis は AI hash 対象外）。それでも canonical 型の変更は最小化したい | **却下** |
| canonical helper (`saveDiagnosisResult`) が hash を引数受け取り | caller (page.tsx) が hash 計算ロジックを持つ。feature → infra 漏洩 | **却下** |
| mirror helper 内で derive (現案) | mirror-local concern。canonical 型・consumer・AI hash すべて不変 | **採用** |

実装は `lib/supabase/mirrorSourceHash.ts::sha256Hex()` 経由（`mirrorBasicInfo` と shared）。browser 専用 API（`crypto.subtle.digest`）だが、mirror helper は元々 `typeof window === "undefined"` で early return するため非 browser 経路はない。

### 7.1 Hash input の選定

```
source_hash = sha256(
  JSON.stringify({ answers, resultType }) + SCHEMA_VERSION
)
```

| Field | Hash に含む? | 理由 |
|---|---|---|
| `answers` | **YES** | user-derived の唯一 content。これが contentidentity の本体 |
| `resultType` | **YES** | defensive — `calcResultType` logic drift が `SCHEMA_VERSION` bump を伴わず起きた場合に observable にするため |
| `createdAt` | **NO** | 含めると identical retake が常に新 row になり、idempotent dedup の意義が失われる |
| `resultTitle` | **NO** | app-authored copy。copy edit のたびに `SCHEMA_VERSION` bump を強制したくない |
| `resultDescription` | **NO** | 同上 |

---

## 8. SCHEMA_VERSION bump triggers (documented contract)

Bump 必須:

1. **`QUESTIONS` array の length 変化**（質問追加 / 削除）→ `answers.length` 変化 → 古 row の `answers` 意味が変わる
2. **`QUESTIONS[i].options` の order 変化** → 同じ index `2` が違う option を指すようになる → answer semantics drift
3. **`DiagnosisType` enum の拡張**（例: 5 番追加）→ 新 type の row が古 schema_version 配下に混入するのを防ぐ
4. **`calcResultType` logic 変更** → 同 answers から異なる resultType が出るようになる

Bump 不要:

- `RESULT_TYPES[type].title` / `description` の copy edit — hash 対象外
- `RESULT_TYPES` 辞書の order 変更 — `resultType` 値そのものが変わらない限り問題なし
- CTA / UI 文言 / 進捗バー / 質問テキストの copy edit（answer index 意味論が変わらない限り）

---

## 9. What this doc deliberately defers

- **`payload` 列の structured 化**: 列展開は schema migration 必須。Phase1 では jsonb dump で十分
- **`user_id` 列**: Phase2 認証導入と同時に additive 追加
- **`anonymous_user_session_id` 列**: anonymous 期間中の再訪 user identity は track しない（device cap として localStorage に閉じる）
- **retention 自動化**: `pg_cron` 等は Phase2 で
- **`payload` 列の `resultTitle`/`resultDescription` 除去**: app-authored だが durable historical snapshot として有用なため Phase1 では保持

---

## 10. Acceptance criteria for the apply STEP

apply STEP（`supabase/schema.sql` §10–§12 追加 + Supabase project apply）の PR で確認:

1. `supabase/schema.sql` に §10 (CREATE TABLE + COMMENT) / §11 (TRIGGER) / §12 (RLS + 2 policies) が追加されている
2. 既存 `student_profile_mirrors` / `basic_info_mirrors` / `mirror_events` の DDL は不変
3. apply 後 24h 以内に `mirror_events` で `feature = "diagnosis" / mirrorStatus = "success"` が >0 件
4. canonical UX は不変 (apply 前後で `app/diagnosis/page.tsx` の挙動・hydration・home の `DiagnosisTypeCard` 表示に変化なし)
5. PII spot-check **不要** — payload に user 自由記述が無いため別軸の確認は行わない（Phase1 mirror として初の no-PII precedent）

---

## 11. Rollback strategy

| トリガ | アクション |
|---|---|
| 急ぎで止めたい (UX 影響なし) | 環境変数 `NEXT_PUBLIC_SUPABASE_MIRROR_DISABLED=true` を設定 → **redeploy** で **3 mirror 全て一括停止**。`NEXT_PUBLIC_*` は build-time inlining されるため env 変更だけでは反映されない（[`phase1_boundary_freeze.md §10 Operator Environment Contract`](./phase1_boundary_freeze.md) 参照）。stale client（モバイル tab / PWA cache）は新 deploy 取得まで旧挙動を継続する点も accept |
| 観測 sink だけ止めたい | `NEXT_PUBLIC_SUPABASE_OBSERVABILITY_DISABLED=true`。mirror upsert は続くが `mirror_events` には書き込まれない |
| schema 自体を撤去 | `DROP TABLE diagnosis_mirrors;` 単独で完結（FK 無し / 他 table 依存無し）。撤去後の mirror INSERT は `network_error` として silently 失敗。runtime / canonical UX に一切影響なし |
| `calcResultType` 結果に異常が出た場合 | mirror は単なる observability 蓄積層。canonical (`passai_diagnosis_result` in localStorage) には影響なし。mirror 側 cleanup は service-role 経由で `DELETE FROM diagnosis_mirrors WHERE created_at >= '...'` |

rollback で破棄した row は復元しない。canonical (localStorage) が source of truth として残るため、user data は失われない。
