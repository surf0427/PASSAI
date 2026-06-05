# self_analysis_logs — Schema Preview（STEP-SUPABASE-COMPLETE-04A）

`supabase/schema.sql` §32–§34 として追記した `self_analysis_logs` テーブルの設計メモ。本 STEP は **schema 定義の追記のみ**。DB への apply・アプリ実コード（`app` / `lib` / `types`）の変更は含まない。

関連:
- [`schema_apply_preflight.md`](./schema_apply_preflight.md) — apply 前提条件
- [`self_analysis_logs_post_apply_checklist.md`](./self_analysis_logs_post_apply_checklist.md) — apply 後検証
- tutor 先行例: `supabase/schema.sql` §19–§23（`tutor_chat_threads` / `tutor_chat_messages`）

---

## 1. 位置づけ — auth-scoped mirror 系統（mirror_events 系統ではない）

本テーブルは **tutor_chat_\* と同じ auth-scoped mirror 系統**に属する。`localStorage` の `selfAnalysisLogs`（key=`'selfAnalysisLogs'`, `lib/selfAnalysisLogStorage.ts`）を **canonical** とし、本テーブルはその「同期先 / mirror 的扱い」として best-effort で後追い同期する。

N=4 mirror（`mirror_events` / 共有 `source_hash`, `supabase/schema.sql` §5）系統とは**別レイヤー**である。違いを明示する:

| | mirror_events 系統（studentProfile / basicInfo / diagnosis / activityData） | auth-scoped 系統（tutor_chat_* / **self_analysis_logs**） |
|---|---|---|
| 所有 | 匿名 anon、user 紐付けなし（`source_hash` で dedup） | `user_id = auth.users(id)` |
| RLS | anon INSERT/UPDATE のみ、SELECT 不可 | owner の SELECT/INSERT/UPDATE/DELETE |
| 観測 | `mirror_events` sink に記録 | sink には記録しない（repository の devWarn のみ） |
| dedup key | `source_hash`（payload ハッシュ） | natural key `(user_id, summary_input_hash)` |

→ **本テーブルに `mirror_events` 由来の検証（success_rate / failure_reason / schema_version 分布）は適用しない**。検証は RLS owner-isolation と upsert 冪等性に絞る（checklist 参照）。

---

## 2. DDL 全文

```sql
-- 32. self_analysis_logs
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

-- 33. trigger: set_updated_at()（§3 で定義済みの共有関数を再利用）
CREATE TRIGGER self_analysis_logs_set_updated_at
  BEFORE UPDATE ON self_analysis_logs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- 34. RLS
ALTER TABLE self_analysis_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "self_analysis_logs owner select"
  ON self_analysis_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "self_analysis_logs owner insert"
  ON self_analysis_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "self_analysis_logs owner update"
  ON self_analysis_logs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "self_analysis_logs owner delete"
  ON self_analysis_logs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
```

---

## 3. 列設計と localStorage 型の対応

canonical 型: `types/selfAnalysisLog.ts` の `SelfAnalysisLog`。

| DB column | localStorage field | 型 / 既定 | 備考 |
|---|---|---|---|
| `id` | （DB 採番） | uuid PK | LS の `id` とは別。LS id は `local_log_id` へ |
| `user_id` | （LS には無い） | uuid NOT NULL FK | owner key。`auth.users(id)` |
| `local_log_id` | `id` | text | `crypto.randomUUID()` 由来。traceability 用、NULL 許容 |
| `summary_input_hash` | `summaryInputHash` | text NOT NULL | dedup natural key。`'legacy:v1'` 固定値も入りうる |
| `analysis` | `analysis` | jsonb NOT NULL | `WallHittingResult` |
| `displayed_questions` | `displayedQuestions` | jsonb DEFAULT `[]` | string[] |
| `answers` | `answers` | jsonb DEFAULT `[]` | string[] |
| `deep_answers` | `deepAnswers` | jsonb DEFAULT `[]` | string[] |
| `free_memo` | `freeMemo` | text DEFAULT `''` | |
| `summary` | `summary` | jsonb NOT NULL | `SummaryResult` |
| `created_at` | `createdAt` | timestamptz DEFAULT now() | LS merge では原値保持 |
| `updated_at` | `updatedAt` | timestamptz DEFAULT now() | trigger で前進 |
| `metadata` | （LS には無い） | jsonb DEFAULT `{}` | 将来拡張用 |

`jsonb` の中身（`WallHittingResult` / `SummaryResult` の shape）は DB 制約では強制しない。canonical は TypeScript 型側で担保し、mirror は LS の値をそのまま運ぶ。

---

## 4. natural key と upsert 再現性

localStorage 側 `persistSelfAnalysisLog`（`lib/selfAnalysisLogStorage.ts`）の挙動:

- `summaryInputHash` 一致の entry が既にあれば **content + `updatedAt` を in-place 上書き**（`id` / `createdAt` は保持）
- 無ければ新規 append（`id` を新規 UUID 採番）

これを DB 側で再現するため、`UNIQUE (user_id, summary_input_hash)` を natural key にする。後続 STEP の repository は `onConflict: "user_id,summary_input_hash"` の upsert を使うことで:

- 同一 hash の再 summarize（cache hit 含む）→ 同一行を update（重複行を作らない）
- 異なる hash → 新規行

という LS の dedup 意味論をそのまま写す。`local_log_id` / `created_at` を payload に毎回含めても、LS は update 時にこれらを保持するため値はぶれない。

---

## 5. read 経路は localStorage canonical のまま（本 STEP の非ゴール）

本 STEP（および後続 04B〜04D）では **read 経路を切り替えない**。`lib/mypage/loadMypageData.ts` / `app/self-analysis/resume/page.tsx` は引き続き `loadSelfAnalysisLogs()`（localStorage）を読む。`loadMypageData` は「Supabase / Auth / user_id を一切呼ばない」を明示的に規定しており（同ファイル冒頭）、マイページ・自己分析 UI の表示は不変。

DB 側は backfill（既存 LS の「上り」一括同期）と dualWrite（新規ログの即時 mirror）で replica を構築するに留める。hydrate / read-through の採否は別 STEP で計測のうえ判断する。

---

## 6. 設計上の注意・未確認点

- **配列上限なし**: tutor（`MAX_THREADS=50` / `MAX_MESSAGES=200`）と異なり、`selfAnalysisLogs` にハード上限はコード上に存在しない。実運用では daily limit で件数が抑制される前提。将来 backfill 負荷が問題化したら上限導入を別途検討。
- **`local_log_id` の追加 unique は今は付けない**: dedup は `(user_id, summary_input_hash)` で充足。04E の read/restore で UI `selectedLogId` マッピングが必要になった時点で再評価。
- **`set_updated_at()` 依存**: §33 trigger は §3 で定義済みの共有関数に依存する。apply 時に関数の存在を先に確認すること（checklist §1）。
