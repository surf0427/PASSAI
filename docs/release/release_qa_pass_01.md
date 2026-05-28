# Release QA Pass 01

実施日: 2026-05-28
対象 branch: `feature/supabase-migration`
直前 commit: `9780437 Update UX audit status`

## 1. 目的

PASSAI release 直前の QA pass。UX audit (`docs/ux/ux_audit_phase1.md`) 後の修正 (STEP-UX-FIX-01 〜 06d, 計 8 commit) が **主要 flow を壊していない** ことを確認する。

本 QA は **静的コードレビュー + lint/tsc** が中心。ブラウザ実機 / mobile 実機での runtime テストは伴わない（実機 test は別 STEP「real user test」で実施）。

---

## 2. QA 手法と限界

### 2.1. 実施できたこと（code-level）

- 主要 flow page の handler / state 配線確認
- LoadingProgress / ConfirmDialog / AbortController callers の wiring static review
- `alert(` / `window.confirm(` の残存 grep
- cache hit gate の display gate ロジック確認
- next-step suggestion の hub 配置確認
- `npx tsc --noEmit`
- `npx eslint app components hooks`

### 2.2. 実施できなかったこと（要実機テスト）

| 項目 | なぜ static で見れないか |
|---|---|
| hydration mismatch | server / client render の diff は実行時にしか出ない |
| mobile layout 崩れ | viewport 別レンダリングが必要 |
| cancel button の実タップ動作 | 実 fetch + abort + state cascade を観察する必要 |
| toast の見え方 (3 秒消滅、pointer-events-none) | 視覚タイミングは browser で確認 |
| spinner flash during cache hit | render-cycle 単位の visual を観察する必要 |
| LoadingProgress 経過秒の動作 | setInterval が start/cleanup 通り動くかは browser のみ |
| ConfirmDialog cancel / OK ボタンの実 click 反応 | DOM event 通過の verify は browser |
| no console.error during normal flow | runtime emit のみ捕捉可能 |

これらは **release 前 real user test** で必ず確認すること（§7）。

---

## 3. QA 対象 flow と pass / fail / not tested

判定凡例:
- ✅ **pass (code-verified)**: 静的レビューで wiring 不整合なし、lint/tsc clean
- 🟡 **partial / known limitation**: 既知 issue が残っているが release blocker ではない（§5）
- ⬜ **not tested (runtime)**: コード上 OK だが実機 / browser 観察が必要

### 3.1. 初回導線

| flow | 確認内容 | 判定 |
|---|---|---|
| Landing (`/`) | static landing page | ✅ |
| `/input/basic` | form submit → `saveBasicInfo` → `router.push('/home')` ([page.tsx:194-202](app/input/basic/page.tsx#L194-L202)) | ✅ |
| `/home` | `nextFeature = getNextFeature(statuses)` + 「今日やるべきこと」表示 ([page.tsx:211-259](app/home/page.tsx#L211-L259)) | ✅ |
| `/diagnosis` | 質問選択 → `saveDiagnosisResult` → result 表示 ([page.tsx:182](app/diagnosis/page.tsx#L182)) | ✅ |
| Home → 各機能 nextFeature 遷移 | runtime click | ⬜ |

### 3.2. 自己分析

| flow | 確認内容 | 判定 |
|---|---|---|
| `/self-analysis` (hub) | `SuggestionCard` 配置 ([page.tsx:80,101](app/self-analysis/page.tsx#L80)) | ✅ |
| `/self-analysis/run` analysis | `useWallHitting` + `analysisLoadingStartedAt` gate ([page.tsx:223,608](app/self-analysis/run/page.tsx#L223)) | ✅ |
| `/self-analysis/run` summarize | `summarizeLoadingStartedAt` gate + cache hit が startedAt 立てない経路 ([page.tsx:430,483](app/self-analysis/run/page.tsx#L430)) | ✅ |
| direct mode (`?mode=direct`) | URL flag で挙動切替（A-04 残） | 🟡 banner 未実装 |
| 結果表示 → `/self-pr` 遷移 | runtime click | ⬜ |

### 3.3. 志望理由書

| flow | 確認内容 | 判定 |
|---|---|---|
| `/statement` (hub) | `SuggestionCard` 配置 ([page.tsx:94,119](app/statement/page.tsx#L94)) | ✅ |
| `/statement/prepare` | follow-up answers の derive pattern (STEP-PAGE-FIX-02) | ✅ |
| `/statement/edit` 添削 | `submitReview` cache hit 早期 return → 後続 `setLoading(true)` 未到達 → LoadingProgress 出ない ([page.tsx:434-453,469-470](app/statement/edit/page.tsx#L434)) | ✅ |
| `/statement/edit` next-action bar | `ReviewResultView` の 3-button (本文修正 / 別名保存 / score) ([ReviewResultView.tsx:112-116](app/statement/edit/components/ReviewResultView.tsx#L112)) | ✅ |
| `/statement/edit` draft save toast | `saveToast` setter + `setTimeout(3000)` cleanup ([page.tsx:584-586,717-723](app/statement/edit/page.tsx#L584)) | ✅ |
| `/statement/edit` cancel loading | `AbortController` + `AbortError` 分岐 + finally cleanup ([page.tsx:307,531-548](app/statement/edit/page.tsx#L307)) | ✅ |
| `/statement/edit` history delete ConfirmDialog | `ConfirmDialog` import + caller ([page.tsx:54](app/statement/edit/page.tsx#L54)) | ✅ |
| `/statement/score` history delete | `ConfirmDialog` 移行済み | ✅ |
| `/statement/analysis/[id]` 次アクション | A-06「書き直しを始める →」 CTA 未追加 | 🟡 |
| `/statement/improve` history delete | `ConfirmDialog` 移行済み | ✅ |
| `/statement/improve/rewrite/[id]` | STEP-PAGE-03 で切り出し済み | ✅ |
| `/statement/compare` | 比較 UI、B-03 残 (hub からの入口) | 🟡 |
| 実 click 経路 (本文修正 button → input scroll) | runtime | ⬜ |

### 3.4. 小論文

| flow | 確認内容 | 判定 |
|---|---|---|
| `/essay` (hub) | 4 カード並列、next-step suggestion 未実装 (A-03 残、STEP-UX-FIX-05b 候補) | 🟡 |
| `/essay-practice` テーマ選択 | `EssayThemeCandidate` derive + themeIndex modulo 正規化 | ✅ |
| `/essay-practice` ミニ思考 / 本文入力 | `MiniThoughtFields` / `BodyInputFields` 切り出し済 | ✅ |
| `/essay-practice` AI壁打ち | `handleChatSubmit` → `/api/essay-chat` | ✅ |
| `/essay-practice` 添削 | cache hit 早期 return → 後続 `setReviewLoading(true)` 未到達 ([page.tsx:363-394](app/essay-practice/page.tsx#L363)) | ✅ |
| `/essay-practice` LoadingProgress | `reviewLoading && reviewLoadingStartedAt !== null` gate ([page.tsx:848](app/essay-practice/page.tsx#L848)) | ✅ |
| `/essay-practice` 「最初からやり直す」 confirm | B-06 残 (native confirm なし、即実行) | 🟡 |
| `/essay/structure/*` / `/essay/write/*` 多 page | 新 architecture flow、static link 整合のみ確認 | ⬜ |

### 3.5. 面接

| flow | 確認内容 | 判定 |
|---|---|---|
| `/interview` (hub) | `SuggestionCard` 配置 ([page.tsx:84,100](app/interview/page.tsx#L84)) | ✅ |
| `/interview/questions` | cache hit が `setAiLoadingStartedAt` を立てない設計 ([InterviewQuestionForm.tsx:113,170-181,187-188](app/interview/questions/components/InterviewQuestionForm.tsx#L113)) | ✅ |
| `/interview/questions` LoadingProgress | display gate `isAiLoading && aiLoadingStartedAt !== null` | ✅ |
| `/interview/record` | 記録機能 | ⬜ |
| `/interview/history` 削除 | 🚨 native `window.confirm` 残存 ([InterviewHistoryClient.tsx:31](app/interview/history/components/InterviewHistoryClient.tsx#L31)) — A-05 残 10/14 件のうち 1 件 | 🟡 |

### 3.6. matching

| flow | 確認内容 | 判定 |
|---|---|---|
| `/matching` redirect | `redirect('/admission-matching')` ([matching/page.tsx](app/matching/page.tsx)) | ✅ |
| `/admission-matching` start matching | `handleStartMatching` で controller 作成、`handleAiEnhance(signal)` 経由 fetch ([page.tsx:341-388](app/admission-matching/page.tsx#L341)) | ✅ |
| `/admission-matching` LoadingProgress | gate `aiLoading && aiLoadingStartedAt !== null` ([page.tsx:485](app/admission-matching/page.tsx#L485)) | ✅ |
| `/admission-matching` cancel | `handleCancelMatching` + unmount cleanup + AbortError 分岐 ([page.tsx:394-405](app/admission-matching/page.tsx#L394)) | ✅ |
| `/admission-matching` partial fail 注意文 | `!isShowingCached && livePartial` で表示 ([page.tsx:509-515](app/admission-matching/page.tsx#L509)) | ✅ |
| `/admission-matching` cached result 表示 | `handleShowCached` は fetch せず snapshot のみ復元 → AbortController 作らない | ✅ |
| `/admission-matching` 2 件の `alert()` (catch / cache 異常系) | `alert('マッチングに失敗しました...')` ([page.tsx:377](app/admission-matching/page.tsx#L377)) と `alert('保存済みの結果を読み込めませんでした。')` ([page.tsx:420](app/admission-matching/page.tsx#L420)) が残存 — audit 範囲外だが不整合 | 🟡 |

### 3.7. tutor

| flow | 確認内容 | 判定 |
|---|---|---|
| `/tutor` 相談開始 | `handleSubmit` → emergency check → daily limit → fetch | ✅ |
| `/tutor` loading bubble | 既存「整理しています…」chat bubble 維持（STEP-UX-FIX-06b で LoadingProgress 見送り、理由は audit §14.3 参照） | ✅ 意図通り |
| `/tutor` response 表示 | `setMessages` で assistant bubble 追加 | ✅ |
| `/tutor` off-topic / emergency | `EMERGENCY_PATTERN` で client-side 1 次 block ([page.tsx:51-55,187-196](app/tutor/page.tsx#L51)) | ✅ |
| `/tutor` 会話履歴消失 | A-09 残（reload で session 消える、Phase 2 候補） | 🟡 |

---

## 4. 全体 metrics

| 指標 | 値 | 備考 |
|---|---|---|
| `npx tsc --noEmit` | clean | §11 で再確認 |
| `npx eslint app components hooks` | 0 errors / 0 warnings | §11 で再確認 |
| 主要 flow page (51 page 中、主要 25 page) | ✅ static-verified | navigation / state 配線正常 |
| `alert(` 残存 (`app` + `components`) | 2 件 | 全て `/admission-matching` の異常系 catch (詳細 §5.1) |
| `window.confirm(` 残存 | 10 件 | A-05 残: `components/activity/*` 9 件 + `interview/history` 1 件 |
| `LoadingProgress` callers | 5 caller (`/admission-matching`, `/essay-practice`, `/statement/edit`, `/interview/questions`, `/self-analysis/run`) | display gate 全て正しい |
| `AbortController` 接続済 client flow | 2 件 (`/statement/edit`, `/admission-matching`) | 残 3 主要 flow は STEP-UX-FIX-06e 候補 |
| `ConfirmDialog` 採用 caller | 4 件 (`/statement/edit`, `/statement/improve`, `/statement/score`, `/self-pr`) | STEP-UX-FIX-04 完了分 |
| hub next-step suggestion | 3/4 hub (`/statement`, `/self-analysis`, `/interview`) | `/essay` 残 (STEP-UX-FIX-05b 候補) |

pass/fail/not-tested 件数:
- ✅ pass (code-verified): **30 項目**
- 🟡 partial / known limitation: **9 項目**（全て audit doc で既出 + release 後対応で十分）
- ⬜ not tested (runtime): **5 項目**（実機 test 必須）
- ❌ fail (release blocker 新規発見): **0 項目**

---

## 5. 見つかった issue

### 5.1. 新規発見

| ID | severity | 対象 | 内容 | 推奨対応 |
|---|---|---|---|---|
| QA-01 | B | `/admission-matching` page.tsx:377, 420 | catch / cache 異常系で `alert()` 2 件残存。S-01 (`alert('保存しました')`) とは別経路だが、blocking modal は UX 一貫性を損なう | release 後の STEP-UX-FIX-04c-MATCHING-ALERT 候補。non-blocking toast / inline banner 化 |

新規 release blocker = **0 件**。

### 5.2. audit doc 既出 (status を §3 で再確認)

| ID | 内容 | release blocker か |
|---|---|---|
| A-02 | rate limit / 残回数 UI 統一 | ✗ release 後 |
| A-04 | `?mode=direct` の banner | ✗ release 後 |
| A-05 残 10 件 | `window.confirm` を `ConfirmDialog` に移行 | ✗ release 後 |
| A-06 | `/statement/analysis/[id]` の「書き直し」 CTA | ✗ release 後 |
| A-11 | mobile sticky bottom action bar | ✗ release 後 |
| A-03 残 1 件 | `/essay` hub の next-step suggestion | ✗ release 後 |
| B-03 | `/statement/compare` の hub 入口 | ✗ release 後 |
| B-06 | `/essay-practice` 「最初からやり直す」 ConfirmDialog 化 | ✗ release 後 |
| A-09 | `/tutor` 会話履歴消失 | ✗ Phase 2 |

---

## 6. release blocker 有無

**release blocker = 0 件**。

UX audit phase 1 で挙げられた S-01 / S-02 / S-03 は STEP-UX-FIX-01 〜 06d で全て解消済み（実装サマリは [`../ux/ux_audit_phase1.md#14-実施結果サマリ-step-ux-note-01-時点`](../ux/ux_audit_phase1.md#14-実施結果サマリ-step-ux-note-01-時点)）。本 QA で新規 release blocker は発見されなかった。

---

## 7. release 前に直すべきもの

**必須**: 0 件。

**強く推奨** (release 直前に実施):

1. **Real user test** (高校生 5-10 名)
   - main flow 5 経路 (基本情報 → 自己分析 → 志望理由書 → 添削 → score) を通し操作
   - mobile (iOS Safari / Android Chrome) と PC (Chrome / Safari) で実機確認
   - 観点: hydration mismatch, layout 崩れ, cancel button 反応, toast 視認性, LoadingProgress 経過秒 setInterval 動作, console.error の発生有無
   - 工数: 1 週間 (準備 + 実施 + フィードバック反映)

2. **本番環境 smoke test**
   - production build (`npm run build && npm start`) で main flow を 1 周
   - 環境変数 / API key / Anthropic SDK の wiring 確認
   - 工数: 半日

3. **`/admission-matching` の 2 件の `alert()` を toast 化** (QA-01)
   - blocking modal を release 前に取り除くと UX 一貫性が完成する
   - 半日で実施可能（STEP-UX-FIX-04c 候補）

---

## 8. release 後でよいもの

§5.2 の audit doc 既出 9 件 + 以下:

- STEP-UX-FIX-04b-CONFIRM-DIALOG-EXTEND (残 10 callers)
- STEP-UX-FIX-05b-ESSAY-HUB-SUGGEST
- STEP-UX-FIX-06e-CANCEL-WIRING-EXTEND (他 3 flow)
- STEP-UX-FIX-07-MOBILE-STICKY
- STEP-UX-FIX-08-RATE-LIMIT-UI
- STEP-UX-FIX-09-DIRECT-MODE-BANNER
- STEP-UX-FIX-10-STATEMENT-ANALYSIS-CTA
- B 系 8 件 / C 系 5 件 (audit doc §5.3 / §5.4)

---

## 9. 次の action

| 順 | action | owner | timing |
|---|---|---|---|
| 1 | 本 QA report レビュー | (project owner) | 即時 |
| 2 | 本番 smoke test (build + start + main flow) | (release responsible) | release 1 週間前 |
| 3 | Real user test 準備 (test scenarios / 招集) | (UX) | release 2-3 週間前 |
| 4 | Real user test 実施 + フィードバック反映 | (UX / dev) | release 1-2 週間前 |
| 5 | QA-01 (`/admission-matching` alert toast 化) を release 前に処理するか判断 | (project owner) | release 直前 |
| 6 | release | — | — |
| 7 | release 後の monitoring (Anthropic usage / error rate / 1 day retention) | (observability) | release 直後 1-2 週 |

---

## 10. 観測項目の不変条件

本 QA report を更新するときは:

- runtime code を変更しない（QA は記録のみ）
- audit doc (`../ux/ux_audit_phase1.md` §14) の status と矛盾しない（矛盾を見つけたら audit doc を先に直し、本 doc は同期する）
- 「未確認のまま pass 扱い」は禁止（§3 の判定凡例を厳守）
- PROMPT_VERSION / cache identity / storage 形式 は不変

---

## 11. 検証 log

```
npx tsc --noEmit
→ clean (no output)

npx eslint app components hooks
→ 0 errors / 0 warnings (no output)
```

実施タイミング: 本 commit (`Add release QA pass report`) 直前。

---

## 12. 関連 doc

- [`../ux/ux_audit_phase1.md`](../ux/ux_audit_phase1.md) — UX audit 正本 (§14 が実施結果サマリ)
- [`../principles/cleanup_phase_summary.md`](../principles/cleanup_phase_summary.md) — フェーズ全体 summary (§8b に UX fix フェーズ)
- [`../principles/feedback_dev_principles.md`](../principles/feedback_dev_principles.md) — 開発方針
- [`../principles/incremental_refactor_policy.md`](../principles/incremental_refactor_policy.md) — 整理ポリシー
