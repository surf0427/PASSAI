# lib/interview/

面接機能 (`/interview` 配下) 用の deterministic helper / type guard / prompt builder
を集約するレイヤー。

## 責務

- 面接練習 → AI フィードバック → 成長メモ → 質問生成の各レーンを支える純粋関数
- AI 呼び出しなし (parse 系を除く)
- localStorage / DB / fetch に触れない
- React / DOM に触れない

UI コンポーネント、ページ、ルート、storage helper は本ディレクトリの責務外。
各々は以下に置く:

- ルート: `app/api/interview-*/route.ts`
- ページ / コンポーネント: `app/interview/`
- localStorage: `lib/interviewRecordStorage.ts`, `lib/interviewDraftStorage.ts`,
  `lib/interviewAdditionalUsage.ts`, `lib/interviewQuestionCache.ts`

## ファイル一覧

| ファイル | 役割 |
|---|---|
| `buildGrowthMemo.ts` | 直近 2 record から `InterviewGrowthMemo` を deterministic に構築 |
| `buildStatementImprovementHints.ts` | 面接フィードバック → 志望理由書改善ヒントへの変換 |
| `inferStatementFocus.ts` | 改善対象 statement section の keyword-based 推定 |
| `buildInterviewQuestionMaterials.ts` | 質問生成用 prompt 素材の圧縮 / truncate |
| `buildInterviewQuestionPrompt.ts` | 2-layer questions の system / user prompt builder |
| `parseInterviewQuestions.ts` | AI 応答 JSON のパース + shape guard |
| `normalizeInterviewFeedback.ts` | AI feedback の defensive 正規化 |
| `isInterviewFeedback.ts` | `InterviewFeedback` の runtime type guard |
| `feedbackToText.ts` | `InterviewFeedback` → 表示用テキスト整形 |
| `interviewQuestionsHelpers.ts` | 質問生成共通 helper |

## 結合方向ルール（重要）

### Statement との結合は **一方向のみ**

```
interview                statement
   |                        ^
   | (型 import: StatementDraft、 |
   |  StatementImprovementTargetSection) |
   |                        |
   | (動線: ?focus=<key> via query param)
   v                        |
buildStatementImprovementHints   statement-edit page
inferStatementFocus              (PR7b で動線確定済)
```

**禁止**:
- `lib/statement/*` から `lib/interview/*` を import すること
- `lib/contextBuilders/statementContext.ts` から `lib/interview/*` を import すること
- statement-edit page が interview-feedback の内部 state を直接読むこと
  （query param `?focus=<targetSection>` 経由のみ許可）

**理由**: 循環依存を構造的に防ぐため。「面接フィードバック → 志望理由書改善」の動線は
interview 側 → statement 側への一方通行で完結する。statement 側で interview の型・helper
が欲しくなった場合は、共通型を `types/statementInterviewInsights.ts` のような中立な
位置に置き、interview / statement 両方からそこを import する。

### admissionFocus / matching とは独立

- `lib/interview/*` は `lib/admissionFocus/*` を **import しない**
  （admissionFocus は interview-feedback **route 側** で消費する）
- `lib/interview/*` は `lib/matching/*` を **import しない**

### Studend Profile 経路

`StudentProfile` は `types/studentProfile.ts` の canonical 型を直接 import する。
`lib/contextBuilders/interviewContext.ts` の `buildInterviewStudentProfileContext()` は
prompt builder 専用ヘルパで、本ディレクトリの builder からは利用しない（責務分離）。

## 検証ポリシー

- すべての builder / parser は **pure function**。テストは入出力固定で書く
- AI 呼び出しを含む関数は本ディレクトリに置かない（route.ts 側に集約）
- `normalizeInterviewFeedback` の defensive fill は silent fallback 設計
  （将来 `partial_fill` status 追加の余地は監査記録に残置）
