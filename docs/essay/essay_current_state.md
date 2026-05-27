# /essay 系 現在仕様

> **役割**: Phase 1 開始時点の責務マップと STEP 進捗を集約。
> 改善フロー（深掘り質問のみ）導入に向けた段階的移行を追跡する。

関連:
- 不変条件: [essay_workspace_invariants.md](./essay_workspace_invariants.md)
- AI ポリシー: [`docs/principles/ai_policy.md`](../principles/ai_policy.md)
- score contract: [`docs/principles/ai_score_contract.md`](../principles/ai_score_contract.md)

---

## 現在のページ構成（STEP C 時点）

- `/essay` — 小論文 hub（3 カード）。[app/essay/page.tsx](../../app/essay/page.tsx)
- `/essay/results` — workspace 一覧（view only）。[app/essay/results/page.tsx](../../app/essay/results/page.tsx)
- `/essay/result/[wid]` — workspace 詳細・添削履歴（view only）。STEP D で改善 hub への CTA を追加
- `/essay/improve/[wid]` — 改善点選択 hub（read only、最新 review の improvement / weakPoints を表示）
- `/essay/improve/[wid]/deep/[issueId]` — 深掘り質問（固定テンプレ 3〜5 問、回答 autosave）+ AI 改善方針生成（dedupe cache 付き）+ 「書き直しに進む」CTA
- `/essay/improve/[wid]/rewrite` — 書き直し本文（左カラム参照素材 + 右カラム textarea）+ 再添削（既存 `/api/essay-review` 流用、submitRewriteReview で atomic 完了）
- `/essay/improve/[wid]/compare` — 改善前後の比較（前回 / 今回 totalScore、breakdown 軸別差分、improvement / goodPoints / weakPoints 並列表示）
- `/essay-practice` — 既存の小論文練習 UI。線形ステップ 0〜5（[app/essay-practice/page.tsx](../../app/essay-practice/page.tsx)）
  - 0: 練習条件設定 → 1: テーマ確認 → 2: ミニ思考欄 → 3: 本文 → 4: 壁打ち → 5: 添削結果

Phase 1（改善フロー導入）は STEP A〜I で完了。Phase 2（整理して書く / いきなり書く）が STEP J 〜 進行中。

## Phase 2 routes（STEP K 時点）

- `/essay/structure` — Phase 2 entry。新規開始 button + 途中の小論文一覧
- `/essay/structure/[wid]/target` — 志望校 / 学部 / 学科 / 入試方式 編集
- `/essay/structure/[wid]/theme` — テーマ候補表示 + rotate（local state）+「このテーマで進む」で確定保存
- `/essay/structure/[wid]/mini` — 結論 + 理由 2 の入力（短文 Input）、autosave
- `/essay/structure/[wid]/sparring` — 固定テンプレ 5 問の Q&A（AI 不使用）、lazy start、autosave
- `/essay/structure/[wid]/body` — 2 カラム（左: 参照素材 / 右: 本文 textarea + 添削 CTA）、`updateBody` autosave + `appendInitialReview` for review submit、成功で `/essay/result/[wid]` 遷移

hub link 状態（STEP O 切替後）:
- 「整理して書く」→ `/essay/structure`（STEP N で切替）
- 「いきなり書く」→ `/essay/write`（STEP O で切替）
- 「改善する」 → `/essay/improve`
- 「結果を見る」 → `/essay/results`

Phase 2 で追加された write 系 route:
- `/essay/write` — entry（新規開始 + 途中の小論文一覧）
- `/essay/write/[wid]/target` — 志望校設定
- `/essay/write/[wid]/theme` — テーマ確認（rotate / 確定保存）
- `/essay/write/[wid]/body` — 本文編集 + 添削 CTA（EssayBodyEditor 利用、`appendInitialReview` で workspace 単独書き込み）

STEP P で完了した polish:
- `buildBasicInfoForAi` を `lib/essay/buildBasicInfoForAi.ts` に extract（4 箇所の inline を置換、shape 不変）
- `getStructureProgress` / `getWriteProgress` 追加、entry カードに「N / M 完了」+ progress dots 表示
- `/essay-practice` 上部に deprecation banner（撤去ではなく、新 architecture への誘導のみ）

legacy 退役判断（Phase 2 完了時点・未実施）:
- `/essay-practice` page 自体は維持（rollback safety、UX banner で誘導するのみ）
- `essayPracticeReview` / `essayPracticeData` への dual-write 維持
- `/api/essay-chat` route 維持（`/essay-practice` 経由のみで使用）
- Phase 3 で legacy 撤去の判断を行う（最低 1 リリース分は併存させる方針）

---

## Phase 1 リリース時点の退役方針（STEP I 確定）

| 項目 | 方針 | 理由 |
|---|---|---|
| `essayPracticeReview`（legacy 保存先） | **維持**。削除しない | rollback safety。Phase 1 のいずれかの bug が見つかったとき、`/essay-practice` 単体に戻して legacy のみで運用できる経路を残す |
| `essayPracticeData`（legacy 進捗 flag） | **維持** | 既存ユーザーが reload した時の UX 不変を保つ |
| dual-write（STEP B で導入、`essayPracticeReview` と `essayWorkspaces` 両方に書く） | **維持** | 同上。Phase 2 完了まで両方書き続ける |
| `/essay-practice` page | **維持** | Phase 2 で `/essay/structure/*` と `/essay/write` に分離するまで現役運用 |

**判断見直しタイミング**: Phase 2 の `/essay/structure/*` と `/essay/write` 実装後、両者で workspace dual-write が確認できた段階で改めて検討する。Phase 1 では削除タイミングを早めない。

---

## 責務マップ（STEP A 完了時点）

| 層 | ファイル | 責務 |
|---|---|---|
| 型 | [`types/essay.ts`](../../types/essay.ts) | `EssayWorkspace` / `ReviewEntry` / `ImprovementInProgress` / `BreakdownAxis` / `BreakdownItem` |
| storage | [`lib/essayWorkspaceStorage.ts`](../../lib/essayWorkspaceStorage.ts) | localStorage I/O / normalize / legacy migration / LRU cap |
| storage (legacy) | [`lib/essayPracticeStorage.ts`](../../lib/essayPracticeStorage.ts) | `essayPracticeReview` / `essayPracticeData` の読み書き。STEP B 以降は dual-write の片側（rollback 用に維持） |
| mutation | [`lib/essay/workspaceOps.ts`](../../lib/essay/workspaceOps.ts) | workspace の純関数 mutation。Phase 1: `appendInitialReview` / `createInitialWorkspace` / `startImprovement` / `abandonImprovement` / `updateImprovementAnswers` / `attachImprovementSummary` / `updateRewriteDraft` / `submitRewriteReview`。Phase 2 STEP J: `updateTarget` / `updateTheme` / `updateMini` / `updateBody` / `startSparring` / `updateSparringAnswers` / `abandonSparring` |
| deep dive | [`lib/essay/deepDiveQuestions.ts`](../../lib/essay/deepDiveQuestions.ts) | axis 別固定質問テンプレ + `inferAxis(text)` fallback inference + `DEEP_DIVE_TEMPLATE_VERSION` |
| issueId | [`lib/essay/issueId.ts`](../../lib/essay/issueId.ts) | `parseIssueId('r{n}-improvement' / 'r{n}-w{i}')` パーサ |
| sparring template | [`lib/essay/sparringQuestions.ts`](../../lib/essay/sparringQuestions.ts) | Phase 2 STEP J 新規。5 問固定テンプレ + `buildSparringQuestions(ctx)` + `SPARRING_TEMPLATE_VERSION` |
| structure resume | [`lib/essay/getStructureResumePath.ts`](../../lib/essay/getStructureResumePath.ts) | Phase 2 STEP K 新規 + STEP P で `getStructureProgress` 追加。`getStructureResumeStep` / `getStructureResumePath` / `getStructureStepLabel` / `isStructureInProgress` / `getStructureProgress` |
| write resume | [`lib/essay/getWriteResumePath.ts`](../../lib/essay/getWriteResumePath.ts) | Phase 2 STEP O 新規 + STEP P で `getWriteProgress` 追加。`getWriteResumeStep` / `getWriteResumePath` / `getWriteStepLabel` / `isWriteInProgress` / `getWriteProgress`（structure と排他フィルタ） |
| UI 部品 | [`app/essay/components/EssayBodyEditor.tsx`](../../app/essay/components/EssayBodyEditor.tsx) | Phase 2 STEP O 新規。本文 textarea + 添削 CTA + error + autosave 注記。入力 UI のみ |
| AI input shaper | [`lib/essay/buildBasicInfoForAi.ts`](../../lib/essay/buildBasicInfoForAi.ts) | Phase 2 STEP P 新規 extract。preferences[0] / examTypes を target で上書きする純関数。`/essay-practice` / `/essay/improve/[wid]/rewrite` / `/essay/structure/[wid]/body` / `/essay/write/[wid]/body` で利用 |
| improve summary | [`lib/essay/parseImproveSummary.ts`](../../lib/essay/parseImproveSummary.ts) | `/api/essay-improve-summary` 出力の defensive normalize |
| improve summary cache | [`lib/essay/improveSummaryCache.ts`](../../lib/essay/improveSummaryCache.ts) | `essayImproveSummaryInputHash` キャッシュ（hash + ImprovementSummary 同居） |
| API route | [`app/api/essay-improve-summary/route.ts`](../../app/api/essay-improve-summary/route.ts) | AI 改善方針生成（本文ドラフト禁止 prompt、PROMPT_VERSION = 1） |
| AI cache | [`lib/essayReviewCache.ts`](../../lib/essayReviewCache.ts) | `essayReviewInputHash` cache（既存・不変） |
| AI parse | [`lib/essay/parseEssayReview.ts`](../../lib/essay/parseEssayReview.ts) | `/api/essay-review` レスポンス normalize（既存・不変） |
| API route | [`app/api/essay-review/route.ts`](../../app/api/essay-review/route.ts) | 既存・不変 |
| API route | [`app/api/essay-chat/route.ts`](../../app/api/essay-chat/route.ts) | 既存・不変 |
| UI | [`app/essay-practice/page.tsx`](../../app/essay-practice/page.tsx) | 既存 UI。STEP A で migration 発火、STEP B で添削成功時に dual-write |
| UI | [`app/essay/page.tsx`](../../app/essay/page.tsx) | hub（Server Component、3 カード） |
| UI | [`app/essay/results/page.tsx`](../../app/essay/results/page.tsx) | workspace 一覧（view only） |
| UI | [`app/essay/result/[wid]/page.tsx`](../../app/essay/result/[wid]/page.tsx) | workspace 詳細・添削履歴（view only、NotFound 対応） |
| UI 部品 | [`app/essay/components/EssayWorkspaceCard.tsx`](../../app/essay/components/EssayWorkspaceCard.tsx) | 一覧の 1 行 summary カード |
| UI 部品 | [`app/essay/components/EssayReviewCard.tsx`](../../app/essay/components/EssayReviewCard.tsx) | 添削履歴の 1 件カード |
| UI 部品 | [`app/essay/components/EssayIssueCard.tsx`](../../app/essay/components/EssayIssueCard.tsx) | 改善点 1 個のカード（variant: primary / secondary、見た目のみ。動作は呼び出し側） |
| UI | [`app/essay/improve/[wid]/page.tsx`](../../app/essay/improve/[wid]/page.tsx) | 改善点選択 hub（最新 review から improvement / weakPoints を抽出、read only） |
| UI | [`app/essay/improve/[wid]/deep/[issueId]/page.tsx`](../../app/essay/improve/[wid]/deep/[issueId]/page.tsx) | 深掘り質問画面（lazy start、autosave、conflict UI、まとめ CTA enable、書き直し CTA） |
| UI | [`app/essay/improve/[wid]/rewrite/page.tsx`](../../app/essay/improve/[wid]/rewrite/page.tsx) | 書き直し本文画面（左カラム参照素材 + 右カラム textarea + 再添削 CTA） |
| UI | [`app/essay/improve/[wid]/compare/page.tsx`](../../app/essay/improve/[wid]/compare/page.tsx) | 改善前後の比較（前回 / 今回 / delta、軸別 diff、テキスト並列、CTA） |
| UI 部品 | [`app/essay/components/BreakdownDiffRow.tsx`](../../app/essay/components/BreakdownDiffRow.tsx) | breakdown 1 軸の前回 → 今回 → delta 表示（色は delta から derive） |

---

## storage キー

| key | ファイル | 形式 | 状態 |
|---|---|---|---|
| `essayWorkspaces` | `lib/essayWorkspaceStorage.ts` | JSON | Phase 1 の正本。STEP B 以降は添削成功時に dual-write される |
| `essayPracticeReview` | `lib/essayPracticeStorage.ts` | JSON | legacy。STEP B 以降も書き込みを維持（rollback 用）。STEP I で停止判断 |
| `essayPracticeData` | `lib/essayPracticeStorage.ts` | JSON | legacy 進捗 flag。STEP I で廃止判断 |
| `essayReviewInputHash` | `lib/essayReviewCache.ts` | JSON | AI dedupe cache。Phase 1 通して不変 |
| `essayImproveSummaryInputHash` | `lib/essay/improveSummaryCache.ts` | JSON | `/api/essay-improve-summary` の input hash + ImprovementSummary 同居 cache。STEP F 新規 |

---

## STEP 進捗

| STEP | 内容 | 状態 |
|---|---|---|
| A | workspace 型 + storage + migration + invariants doc | **実装完了** |
| B | `/essay-practice` の review 保存を essayWorkspaces に dual-write 化 | **実装完了** |
| C | `/essay` hub + `/essay/results` 一覧 + `/essay/result/[wid]` view | **実装完了** |
| D | `/essay/improve/[wid]` 改善点選択 hub | **実装完了** |
| E | `lib/essay/deepDiveQuestions.ts` + `lib/essay/issueId.ts` + `/essay/improve/[wid]/deep/[issueId]` | **実装完了** |
| F | `/api/essay-improve-summary` + improveSummaryCache + attachImprovementSummary + deep page CTA enable | **実装完了** |
| G | `/essay/improve/[wid]/rewrite` + 再添削（最大危険点） | **実装完了** |
| H | `/essay/improve/[wid]/compare` | **実装完了** |
| I | polish + 導線確認 + 退役方針確定（dual-write / legacy はいずれも維持） | **実装完了** |
| J (Phase 2) | Foundation: SparringSession 型 + sparringQuestions テンプレ + workspaceOps 7 関数追加（UI 不変） | **実装完了** |
| K (Phase 2) | `/essay/structure` entry + `/essay/structure/[wid]/target` | **実装完了** |
| L (Phase 2) | `/essay/structure/[wid]/theme` + `/essay/structure/[wid]/mini` | **実装完了** |
| M (Phase 2) | `/essay/structure/[wid]/sparring`（テンプレ Q&A、autosave） | **実装完了** |
| N (Phase 2) | `/essay/structure/[wid]/body` + 添削 submit + hub link 切替 | **実装完了** |
| O (Phase 2) | `/essay/write`（フロー②）+ EssayBodyEditor 抽出 | **実装完了** |
| P (Phase 2) | Polish（buildBasicInfoForAi extract / progress dots / deprecation banner / docs 整備） | **実装完了** |
| J | フロー②（いきなり書く）= `/essay/write` | Phase 2 |
| K | フロー①（整理する）= `/essay/structure/*` | Phase 2 |
| L | legacy `/essay-practice` の deprecate | Phase 2 |

---

## 既存思想との整合

- **AI policy**: 改善まとめ（STEP F の `/api/essay-improve-summary`）は「改善方針」のみ生成。本文ドラフト禁止を prompt に明記する
- **score contract**: 既存 `/api/essay-review` を再添削にも流用するため、score contract は不変。PROMPT_VERSION bump 不要
- **architecture rules**: storage は `lib/` 直下 flat（[architecture_rules.md](../principles/architecture_rules.md)）
- **incremental refactor**: STEP A〜I の 1 STEP 1 ファイル原則を維持
