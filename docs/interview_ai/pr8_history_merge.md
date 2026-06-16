# Interview AI — PR8 履歴統合（read-through + 2 ソース結合 + source 分岐 UI）

AI 面接履歴（Supabase, completed）を read-through で取得し、対人面接記録（localStorage）と
1 リストに結合して表示する。`source: 'human' | 'ai_voice'` を付与し、カードを source で分岐する。

実装:
- 型: [types/interviewHistory.ts](../../types/interviewHistory.ts)（`UnifiedInterviewRecord` / `InterviewSource`）
- read-through DB 境界: [lib/supabase/interviewAiResults.ts](../../lib/supabase/interviewAiResults.ts)
- repository: [lib/repository/interviewAiRepository.ts](../../lib/repository/interviewAiRepository.ts)
- UI: [InterviewHistoryClient](../../app/interview/history/components/InterviewHistoryClient.tsx) / [List](../../app/interview/history/components/InterviewHistoryList.tsx) / [Card](../../app/interview/history/components/InterviewHistoryCard.tsx)

> **不変条件**: `feedbackToText` / `parseImprovementSummary`（Card 内ローカル関数）は **変更しない**。
> `InterviewFeedback` / `LevelEvaluation` 型も **変更しない**。AI 履歴は feedbackToText を *再利用* する。

---

## 1. read 経路（read-through）

```
InterviewHistoryClient (useEffect, post-mount, userId 確定後)
  → interviewAiRepository.getAiInterviewHistory(userId)
    → supabase/interviewAiResults.listCompletedAiInterviews(userId)
      → getBrowserSupabaseClient()（user-scoped, RLS 適用）
        SELECT interview_ai_sessions
          (id, created_at, target_ref, interview_ai_results(feedback))
        WHERE user_id = :userId AND status = 'completed'
        ORDER BY created_at DESC
```

- user-scoped browser client なので RLS が効く。interview_ai_results の SELECT は **session 経由の
  EXISTS**（schema.sql §60）で owner に閉じる（PR7 §3.5 の RLS 正に整合）。
- never throw。env 未設定 / error / 未ログインは AI 分 0 件（対人記録のみ表示）。
- `feedback` は `isInterviewFeedback` で検証し、妥当な行のみ採用。

---

## 2. 結合ロジック（2 ソース）

`interviewAiRepository.mergeInterviewHistory(humanRecords, aiRecords)`（純関数）:

1. 対人記録（`StoredInterviewRecord[]`）→ `UnifiedInterviewRecord`（`source: 'human'`）に射影。
2. AI 履歴（`getAiInterviewHistory` が `source: 'ai_voice'` を付与済み）と連結。
3. `practiceDate`（YYYY-MM-DD 文字列）で **降順**ソート。同日は human を先に安定化。

AI → UnifiedInterviewRecord の射影（`getAiInterviewHistory`）:

| UnifiedInterviewRecord | AI ソース |
|---|---|
| `id` | session.id |
| `source` | `'ai_voice'` |
| `practiceDate` | session.created_at の日付部（`slice(0,10)`） |
| `universityName` / `facultyName` | target_ref（version 付き jsonb）から抽出 |
| `examType` / `partner` / `mainQuestion` | `''`（対人前提 UI のため空 → Card で非表示） |
| `improvementSummary` | **`feedbackToText(feedback)` を再利用** |
| `feedbackJson` | `JSON.stringify(feedback)`（Card の insights CTA 用） |

> feedbackToText 再利用により、AI 履歴も対人記録と同じ ①〜⑥ 構造で Card に描画され、
> `parseImprovementSummary`（Card 内）もそのまま機能する（両方とも未変更）。

---

## 3. source 別 UI 分岐（InterviewHistoryCard）

`const isAi = record.source === 'ai_voice'` で分岐:

| 要素 | human | ai_voice |
|---|---|---|
| 種別バッジ | 入試方式（examType） | 「AI面接（音声）」 |
| 練習相手（partner） | 表示 | **非表示** |
| 主な質問（mainQuestion） | 表示 | **非表示**（逐次ターン構成のため） |
| AI改善アドバイス（improvementSummary） | 表示 | 表示 |
| 志望理由書改善 CTA（insights） | feedbackJson があれば表示 | 同左 |
| 削除ボタン | 表示（localStorage 削除） | **非表示**（AI 履歴削除は本 Card 外） |

- 対人前提 UI（partner / examType / mainQuestion）は ai_voice で出さない（要件）。
- 削除は対人記録（localStorage）のみ。AI 履歴の削除導線は本 PR の対象外。

---

## 4. completed / in_progress / abandoned の表示方針

| status | 履歴表示 | 方針 |
|---|---|---|
| `completed` | **表示する** | read-through が `status='completed'` で絞る。履歴の対象はこれのみ |
| `in_progress` | 履歴に出さない | 「再開（続きから）」導線側に寄せる（PR5 session 作成の in-progress-exists / 続きから）。履歴 read-through の対象外 |
| `abandoned` | **原則非表示** | read-through が completed のみ取得するため自然に除外。「中断」として別表示するのは将来オプション（本 PR では非表示を採用） |

> 履歴 = 完了した面接の記録、という一貫性を保つ。中断・進行中は履歴の意味論に載せない。

---

## 5. 監査報告（PR8 完了時）

| 項目 | 結果 |
|---|---|
| interview_ai_results の RLS 方式 | **session 経由の EXISTS が正**（schema.sql §60）。user_id は denormalized（PR7 §3.5）。read-through は user-scoped client で RLS 越しに読む |
| interviewAiRepository の read 経路 | Client effect → `getAiInterviewHistory` → `listCompletedAiInterviews` → browser supabase（RLS）。completed のみ |
| 履歴結合ロジック | `mergeInterviewHistory`（純関数）。human→unified + ai を practiceDate 降順、同日 human 優先 |
| source 別 UI 分岐 | Card `isAi` 分岐。ai_voice は partner / examType / mainQuestion / 削除を非表示、専用バッジ |
| completed / in_progress / abandoned | completed のみ表示 / in_progress は再開導線 / abandoned は非表示 |
| feedbackToText / parseImprovementSummary 変更なし | **変更していない**（feedbackToText.ts は diff 外、parseImprovementSummary 本体も無変更）。AI は feedbackToText を再利用 |
| tsc / eslint | exit 0 / exit 0 |

---

## 6. 後続（PR9+ 想定）

- AI 履歴カードの「詳細を見る」導線（ターン transcript / feedback 全文表示）。
- abandoned を「中断」として別セクション表示するか否かの製品判断。
- AI 履歴の削除導線（session/results/turns の owner 削除）。
- voice STT 実プロバイダ接続（PR6 境界）。
