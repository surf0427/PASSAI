# interview_practice_records — Schema Preview（STEP-INTERVIEW-AI-PR1）

localStorage key `interview_records`（面接練習記録 / `lib/interviewRecordStorage.ts` の
`StoredInterviewRecord[]`）の auth-scoped Supabase durable mirror を新規追加する。

関連: [migration_phases.md](./migration_phases.md), [feature_rollout_matrix.md](./feature_rollout_matrix.md),
[statement_review_history_mirror_schema_preview.md](./statement_review_history_mirror_schema_preview.md)（最も近い前例）,
[self_prs_mirror_schema_preview.md](./self_prs_mirror_schema_preview.md),
[../interview_ai/pr0_design.md](../interview_ai/pr0_design.md)。

> 本書は **schema 設計の単一情報源**。DDL の実 apply は operator 操作
> （[interview_practice_records_post_apply_checklist.md](./interview_practice_records_post_apply_checklist.md)）。

---

## 1. 目的 / 位置づけ — auth-scoped mirror 系統（mirror_events 系統ではない）

- 面接練習記録は localStorage canonical（key=`interview_records`）。本 table は **durable mirror**（best-effort 同期先）。
- `self_prs` §35 / `statement_review_history` §38 / `self_analysis_logs` §32 / `tutor_chat_*` §19 と同じ
  **auth-scoped 永続層**。anonymous の `*_mirrors`（mirror_events 系統）ではない。
- RLS は常に `auth.uid() = user_id` で閉じる。書き込みは認証済み client（browser）から best-effort。
- 上り（LS → Supabase）のみ。read 切替 / restore は本 PR の非対象（delete resurrection 回避のため別 STEP）。

Phase1 契約（[migration_phases.md](./migration_phases.md) §4 Phase1）との整合:

- canonical は localStorage 一択。UX は mirror の成否に依存しない。
- mirror helper は canonical 書き込みの **後段** に置く（PR2 で配線）。失敗は devWarn のみ、リトライ責務なし。

---

## 2. DDL 全文

実装は `supabase/schema.sql` §53–§55。以下は同内容の抜粋。

```sql
CREATE TABLE interview_practice_records (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_record_id     text         NOT NULL,
  practice_date       text         NOT NULL DEFAULT '',
  university_name     text         NOT NULL DEFAULT '',
  faculty_name        text         NOT NULL DEFAULT '',
  exam_type           text         NOT NULL DEFAULT '',
  partner             text         NOT NULL DEFAULT '',
  main_question       text         NOT NULL DEFAULT '',
  improvement_summary text         NOT NULL DEFAULT '',
  questions_asked     text         NOT NULL DEFAULT '',
  my_answers          text         NOT NULL DEFAULT '',
  what_went_wrong     text         NOT NULL DEFAULT '',
  feedback_received   text         NOT NULL DEFAULT '',
  self_noted          text         NOT NULL DEFAULT '',
  feedback_json       jsonb,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  metadata            jsonb        NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT interview_practice_records_local_unique UNIQUE (user_id, local_record_id)
);

CREATE TRIGGER interview_practice_records_set_updated_at
  BEFORE UPDATE ON interview_practice_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE interview_practice_records ENABLE ROW LEVEL SECURITY;
-- owner select / insert / update / delete（auth.uid() = user_id）
```

---

## 3. 列設計と localStorage 型の対応

domain 型: `StoredInterviewRecord`（`lib/interviewRecordStorage.ts`）。

| DB 列 (snake_case) | StoredInterviewRecord | 型 / 既定 | 備考 |
|---|---|---|---|
| `local_record_id` | `id` | text NOT NULL | natural key。crypto.randomUUID() 文字列 |
| `practice_date` | `practiceDate` | text DEFAULT '' | 練習日（文字列） |
| `university_name` | `universityName` | text DEFAULT '' | |
| `faculty_name` | `facultyName` | text DEFAULT '' | |
| `exam_type` | `examType` | text DEFAULT '' | |
| `partner` | `partner` | text DEFAULT '' | 面接相手 |
| `main_question` | `mainQuestion` | text DEFAULT '' | |
| `improvement_summary` | `improvementSummary` | text DEFAULT '' | |
| `questions_asked` | `questionsAsked` | text DEFAULT '' | legacy フィールド（旧形式） |
| `my_answers` | `myAnswers` | text DEFAULT '' | legacy フィールド（旧形式） |
| `what_went_wrong` | `whatWentWrong` | text DEFAULT '' | |
| `feedback_received` | `feedbackReceived` | text DEFAULT '' | |
| `self_noted` | `selfNoted` | text DEFAULT '' | |
| `feedback_json` | `feedbackJson?` | jsonb NULL | §6。LS は JSON 文字列、DB は jsonb |
| `created_at` | `createdAt` | timestamptz | backfill 時に原値保持 |
| `updated_at` | `updatedAt` | timestamptz | §54 trigger で DO UPDATE 経路は now() 上書き |
| `metadata` | — | jsonb DEFAULT '{}' | 前方互換用（self_prs に倣う） |

> `questions_asked` / `my_answers` は `StoredInterviewRecord` のコメントで Deprecated と明記された
> 旧形式フィールド。mirror は raw を忠実に保存し、削除判断は LS canonical 側の整理 STEP に委ねる。

---

## 4. natural key に `(user_id, local_record_id)` を使う理由

- `local_record_id = StoredInterviewRecord.id`（crypto.randomUUID()）を identity とする。
- 同一大学・同一日付の別練習も**別個の正当な記録**。contentHash で潰すと正しい履歴が消える。
- `onConflict='user_id,local_record_id'` の冪等 upsert により、backfill 再実行 / dualWrite の重複が安全。

## 5. contentHash を使わない理由

- 面接記録は inputHash / cache 概念を持たない（AI cache lane ではない）。
- id 以外を dedup key にすると、再練習・同条件練習が誤って 1 行に潰れる。id 一意性に委ねる。

## 6. `feedback_json` を jsonb で保存する理由

- `StoredInterviewRecord.feedbackJson` は AI 面接フィードバック（`InterviewFeedback`）の JSON **文字列**。
- DB では `statement_review_history.result` と同方針で **jsonb** に正規化して保存する（将来の構造化 read / 集計余地）。
- 境界（`lib/supabase/interviewPracticeRecords.ts`）で:
  - 書き込み: `JSON.parse(feedbackJson)` → 失敗 / 欠落は `NULL`（best-effort。壊れた raw で mirror を止めない）。
  - 読み出し: `JSON.stringify(feedback_json)` で元の文字列形に戻す。
- 旧記録は `feedbackJson` 欠落のため `feedback_json IS NULL`。read 側正規化（`feedbackToText` / `isInterviewFeedback`）が表示を担保。

## 7. UPDATE policy を作った理由（self_prs / statement 同形）

- 記録は in-place 編集経路を持たない（作成 + 削除のみ）が、Supabase の `.upsert(..., {onConflict})` は
  `INSERT ... ON CONFLICT DO UPDATE` を発行する。
- UPDATE policy が無いと冪等な再 upsert（backfill 再実行）が DO UPDATE 経路で RLS に弾かれ、
  mirror helper の devWarn に黙って失敗が出続ける。これを避けるため owner update policy を置く。

## 8. restore / delete 伝播を今回入れない理由（delete resurrection）

- 面接記録は delete を伴う feature（`deleteInterviewRecord`）。
- 本 PR（PR1）と PR2 の上り mirror は **upsert-only**（`propagateDelete=false` 既定）。
- DB → LS の down-sync / restore を安易に入れると、ある端末で消した記録が別端末の mirror から蘇る。
- restore は tombstone 設計後の別 STEP に分離する。それまで DB に残骸が残るのは許容（canonical は LS）。

---

## 9. PR 工程メモ

| PR | 内容 | 本書との関係 |
|---|---|---|
| **PR1** | 本 schema + RLS + DB 境界 + repository（1 件 mirror entry point、未配線） | 本書が確定 |
| PR2 | repository に backfill + dualWrite delta 追加 + 配線（AuthProvider / record 作成 / 履歴削除） | §8 の propagateDelete 方針を継承 |
| PR3〜 | interview_ai_* schema（リアルタイム面接 / 課金）。本 table とは別系統 | [pr0_design.md](../interview_ai/pr0_design.md) |

> PR1 は **純追加**。app / `interviewRecordStorage.ts` は無変更で、誰も新規ファイルを import しない。
> Supabase 未 apply でも build / 既存 UX は無影響（`getBrowserSupabaseClient()` null で no-op）。
