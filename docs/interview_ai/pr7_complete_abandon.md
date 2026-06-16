# Interview AI — PR7 complete / abandon（final feedback + 結果保存 + 状態更新）

セッションの終了経路。`/complete`（フィードバック生成 + 結果保存 + completed）と
`/abandon`（abandoned 更新のみ）を実装する。PR3 schema + PR6 turns の上に乗る。

実装:
- [app/api/interview-ai/complete/route.ts](../../app/api/interview-ai/complete/route.ts)
- [app/api/interview-ai/abandon/route.ts](../../app/api/interview-ai/abandon/route.ts)
- [lib/interviewAi/finalFeedback.ts](../../lib/interviewAi/finalFeedback.ts)（生成 + 射影）
- [lib/interviewAi/completion.ts](../../lib/interviewAi/completion.ts)（results upsert + status 更新）

> 状態値は **`abandoned`**（route 名 `/abandon` と統一）。PR3 で `aborted` としていた箇所は
> 本 PR で `abandoned` に統一済み（schema.sql §56 CHECK + pr0/pr3 docs）。

---

## 1. 契約

### POST /api/interview-ai/complete `{ sessionId }`

| status | body |
|---|---|
| 200 | `{ status: 'completed', feedback, strengths, improvements, nextPractice }` |
| 400 | `{ error: 'invalid-body' }` |
| 401 | 未認証 |
| 404 | `{ error: 'session-not-found' }` |
| 409 | `{ error: 'session-not-in-progress' \| 'no-turns' }` |
| 500 | `{ error: 'turn-load-failed' \| 'results-save-failed' \| 'status-update-failed' \| 'complete-failed' }` |
| 502 | `{ error: 'feedback-generation-failed' \| 'feedback-truncated' \| 'feedback-parse-failed' }` |

### POST /api/interview-ai/abandon `{ sessionId }`

| status | body |
|---|---|
| 200 | `{ status: 'abandoned' }` |
| 400 | `{ error: 'invalid-body' }` |
| 401 | 未認証 |
| 404 / 409 | `session-not-found` / `session-not-in-progress` |
| 500 | `{ error: 'status-update-failed' \| 'abandon-failed' }` |

---

## 2. complete の処理順序

1. 認証 + `loadInProgressOwnedSession`（存在 / 所有者 / in_progress）。
2. turns 取得。**回答 0 件なら 409 `no-turns`**（空セッションは完了対象外）。
3. `generateFinalFeedback`（InterviewFeedback / **logAiUsage のみ**）。失敗 → 502、session は in_progress のまま（再 complete 可）。
4. `projectResultArrays` で正規化カラムへ射影。
5. `saveInterviewAiResults`（upsert / onConflict=session_id）。失敗 → **明示 500** `results-save-failed`。
6. `updateSessionStatus('completed')`（in_progress 限定 UPDATE）。失敗 → 明示 500、更新 0 件 → 409（競合）。
7. 200 を返す。

> **recordUsage は呼ばない**。課金は turn route の STT 成功 / 回答保存で確定済み（pr0_design.md §4）。
> complete / abandon / finalFeedback / completion は `lib/billing/usageLog`（recordUsage）を import しない。

---

## 3. final feedback とカラム射影

- 生成は既存 `InterviewFeedback` 契約（types/interview.ts）を再利用し、`isInterviewFeedback` で runtime 検証（pr0_design.md §8）。
- 射影元（[finalFeedback.ts](../../lib/interviewAi/finalFeedback.ts) `projectResultArrays`）:

| interview_ai_results 列 | 射影元（InterviewFeedback） |
|---|---|
| `strengths` | `goodPoints` |
| `improvements` | `improvements` |
| `next_practice` | `nextPractice` |

- `feedback`（jsonb）は InterviewFeedback 全体を保存。`isInterviewFeedback` は goodPoints/nextPractice を緩く扱うため、射影時に `string[]` へ防御的に正規化する。

---

## 3.5 interview_ai_results の RLS と user_id の位置づけ（PR7 追補 / 必須）

`interview_ai_results.user_id` は **denormalized column**（一覧 / 集計 / JOIN 回避用）であり、
**RLS の所有者判定の正ではない**。

- **RLS owner 判定の正** は `interview_ai_sessions` 経由の **EXISTS**（schema.sql §60、4 policy すべて）:
  ```sql
  USING ( EXISTS (
    SELECT 1 FROM interview_ai_sessions s
    WHERE s.id = interview_ai_results.session_id
      AND s.user_id = auth.uid()
  ) )
  ```
- したがって `interview_ai_results.user_id` と `interview_ai_sessions.user_id` が万一ズレても、
  **RLS は `sessions.user_id` を信頼する**（results.user_id は判定に使わない）。
- `results.user_id` は read-through（PR8 の interviewAiRepository）が JOIN なしで owner 行を
  絞る / 集計するための補助に留める。**`user_id = auth.uid()` を RLS の述語にはしない**。
- 書き込み（complete の upsert）は service_role（RLS バイパス）が `session.user_id` を複製して入れる。
  複製の整合は書き込み側の責務で、読み取りの安全性は EXISTS が担保する（二層）。

> まとめ: 所有権の単一情報源は **親 session**。results.user_id は利便のための非正規化であり、
> セキュリティ境界としては EXISTS（session 経由）を正とする。

---

## 4. 失敗時の挙動

| 失敗 | 挙動 |
|---|---|
| final feedback 生成（API error / truncation / parse / guard 不一致） | 502。`FinalFeedbackError`。results 未保存 / status 据え置き（in_progress）。**recordUsage なし**。再 complete で再試行可 |
| results 保存（Supabase） | 明示 500 `results-save-failed`。best-effort にしない。status 未更新（再試行可） |
| status 更新（Supabase） | 明示 500 `status-update-failed`。results は upsert 済（onConflict 冪等なので再 complete 安全） |
| status 更新 0 件（競合で既に completed/abandoned） | 409 `session-not-in-progress` |

> 生成 → results → status の順。途中失敗でも session は in_progress に留まり、再 complete は
> results upsert（冪等）+ status 再更新で安全に回復できる。

---

## 5. 監査報告（PR7 完了時）

| 項目 | 結果 |
|---|---|
| recordUsage が complete / abandon で呼ばれていない | **呼ばれない**。complete/abandon/finalFeedback/completion は recordUsage を import しない（`lib/billing` 参照は auth 用 `authenticateRequest` のみ） |
| interview_ai_results の保存内容 | `feedback`(InterviewFeedback jsonb) + `strengths`/`improvements`/`next_practice`(text[])。upsert onConflict=session_id |
| 射影元 | strengths←goodPoints / improvements←improvements / next_practice←nextPractice |
| session status 更新箇所 | [completion.ts](../../lib/interviewAi/completion.ts) `updateSessionStatus`（in_progress 限定）。complete→'completed' / abandon→'abandoned' |
| final feedback 生成失敗時 | 502（in_progress 据え置き / recordUsage なし / 再試行可） |
| Supabase 保存失敗時 | 明示 500（`results-save-failed` / `status-update-failed`）。best-effort にしない |
| tsc / eslint | exit 0 / exit 0 |

---

## 6. 後続（PR8+ 想定）

- complete 結果（results / feedback）の client 表示・履歴連携。
- voice STT 実プロバイダ接続（PR6 の境界を埋める）。
- interview_practice_records（既存記録 mirror）との UI 統合。
