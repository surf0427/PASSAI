# Release Smoke Test 01

作成日: 2026-05-28
対象 branch: `feature/supabase-migration`
直前 commit: `1dc3456 Update release QA alert status`

## 1. 目的

PASSAI の **本番 URL** (`production build` + `production env`) で、最小限の主要 flow が壊れていないことを確認する。STEP-RELEASE-QA-01 (`docs/release/release_qa_pass_01.md`) は **static code レビュー** が中心だったため、本 smoke test では以下を実機で観察する:

- production build (`npm run build && npm start`) が起動すること
- production env (Supabase URL / API key / Anthropic API key) の wiring が正しいこと
- routing / SSR / hydration が壊れていないこと
- localStorage 系の save / load が production で意図通り動くこと
- AI route が response を返すこと (rate limit / timeout 含む)
- mobile viewport で layout が崩れていないこと
- console.error / native alert / native confirm が主要 flow に出ないこと

**本 doc は手順書**。実施結果の記録は別 doc (`release_smoke_test_results_NN.md` 等) に分けて保存する。

---

## 2. テスト前提

### 2.1. 環境

| 項目 | 値 |
|---|---|
| URL | 本番 deploy URL (e.g. `https://passai.example.com`) — production build 必須 |
| build | `npm run build && npm start` (vercel / 同等) で起動した production bundle |
| env | `.env.production` 相当の Supabase URL / Anthropic API key 等が正しく注入されていること |
| browser | PC Chrome 最新版 (主軸) + iOS Safari 最新版 (mobile 確認) + Android Chrome (任意) |
| ネット環境 | 通常の home / café 程度の wifi (極端な低速回線は別 test) |

### 2.2. テストアカウント / データ

- テスト用 **新規アカウント** を 1 つ用意し、本 smoke test 専用で使う（既存ユーザーの localStorage に介入しない）
- 本 test 開始時に DevTools → Application → Storage → `Clear site data` で localStorage / sessionStorage / Cookie を空にして hydration 初期状態から開始
- 大学名 / 学部 / 学年 / 評定 などの **テストデータ** は実存するが個人特定不能な値を使う (`東京テスト大学` / `テスト学部` 等)

### 2.3. API 使用量

- 各 AI route は 1 回ずつのみ実行する想定（cache hit ありの 2 回目実行で transparency 確認はオプション）
- daily limit ({statement-review / tutor / etc.}) を 1 回ずつ消費する。実施後 24 時間以内に同じテストアカウントで再実行する場合は **rate limit に注意**

### 2.4. 観察ツール

- DevTools Console を常に開いて `console.error` / `console.warn` を観察
- DevTools Network で AI route の status / response time を観察
- DevTools Application > Local Storage で `wallHittingResult` / `statementDraft` / `aiMatchAdviceCache` 等の save を観察
- mobile 確認は実機 or DevTools の Responsive モード (375x812 = iPhone X 想定)

---

## 3. Smoke Test Checklist

severity 凡例 (§5 と対応):
- **S** = release blocker。stop 必須
- **A** = release 前修正推奨
- **B** = release 後修正で十分
- **C** = backlog

判定凡例:
- ✅ pass / ❌ fail / ⬜ not yet tested

| # | category | 項目 | 手順 | 期待結果 | severity | 結果 | 備考 |
|---|---|---|---|---|---|---|---|
| 01 | 初回導線 | Landing 表示 | `/` にアクセス | 200 OK / hero 表示 / hydration error なし | S | ⬜ | |
| 02 | 初回導線 | 基本情報入力 → Home | `/input/basic` で大学・学年・評定等を入力 → 「次へ」 | `saveBasicInfo()` が localStorage に保存 / `/home` に redirect | S | ⬜ | |
| 03 | 初回導線 | Home nextFeature 表示 | `/home` 表示 | 「今日やるべきこと」 card 表示 (`nextFeature = getNextFeature(statuses)` の結果) | S | ⬜ | |
| 04 | 初回導線 | Home → 自己分析 hub | nextFeature CTA クリック (基本情報直後は自己分析へ誘導される想定) | `/self-analysis` 遷移 / SuggestionCard 表示 | A | ⬜ | |
| 05 | 自己分析 | 活動入力 → 分析開始 | `/input/activity` で活動 1〜2 件入力 → `/self-analysis/run` で「AIに分析させる」 | LoadingProgress 表示 (経過秒 + sub-message rotate) / 約 20-30 秒で結果表示 | S | ⬜ | analysis API |
| 06 | 自己分析 | 深掘り → 活動まとめ生成 | 深掘り質問に 1-2 件回答 → 「活動まとめを生成する」 | summarize LoadingProgress 表示 → `SummarySection` 表示 / `StudentProfile` 保存 | S | ⬜ | summarize API |
| 07 | 自己分析 | 結果画面 → 自己PR 導線 | 「自己PR添削ページへ進む →」CTA | `/self-pr?from=run` 遷移 / 既存 PR or 新規入力 | A | ⬜ | |
| 08 | 志望理由書 | 整理する → 書く 導線 | `/statement` → SuggestionCard CTA | `/statement/prepare` or `/statement/edit` 遷移 | A | ⬜ | |
| 09 | 志望理由書 | 添削開始 | `/statement/edit` で大学・学部・本文 100 字以上入力 → 「AI添削する」 | LoadingProgress 表示 (経過秒 + sub-message) / 約 15-20 秒で結果表示 | S | ⬜ | statement-review API |
| 10 | 志望理由書 | next-action bar | 添削結果直下の 3-button | 「↑ 本文を修正する」で input section に scroll / 「💾 別名で保存する」で toast / 「📊 完成度スコアを見る →」で `/statement/score` 遷移 | A | ⬜ | |
| 11 | 志望理由書 | draft save toast | 「下書きを保存する」クリック | 非 blocking toast「下書きを保存しました」が 3 秒で消える / native alert は出ない | S | ⬜ | STEP-UX-FIX-01 |
| 12 | 志望理由書 | LoadingProgress cancel | 添削開始 → 経過 5-10 秒で「キャンセル」button をクリック | LoadingProgress 即座に消える / error banner 出ない / 結果も出ない / loading 状態が残らない | S | ⬜ | STEP-UX-FIX-06c |
| 13 | 志望理由書 | cache hit (2 回目同入力) | 同じ大学・本文で「AI添削する」 再度クリック | LoadingProgress 出ない (spinner flash なし) / 即座に結果表示 / Network tab で `/api/statement-review` 呼ばれない | A | ⬜ | cache identity |
| 14 | 志望理由書 | history delete ConfirmDialog | `/statement/score` で履歴削除アイコンクリック | native confirm ではなく `ConfirmDialog` modal 表示 / 「キャンセル」で消える、「削除」で履歴削除 | A | ⬜ | STEP-UX-FIX-04 |
| 15 | matching | 診断開始 | `/admission-matching` で「志望校マッチングをする」 | LoadingProgress (約 30 秒) → 結果画面 (ResultView) | S | ⬜ | matching API |
| 16 | matching | LoadingProgress cancel | 上記 #15 進行中に「キャンセル」 | LoadingProgress 消える / confirm 画面に留まる / red error banner 出ない (AbortError 分岐) | S | ⬜ | STEP-UX-FIX-06c |
| 17 | matching | 失敗時 inline banner | (network 切断 等で意図的に失敗させる、難しければ skip) | red inline banner「マッチングに失敗しました...」が ConfirmView 直上に表示 / native alert 出ない | A | ⬜ | STEP-QA-FIX-01 |
| 18 | matching | cached result 表示 | 一度成功後、`/admission-matching` で「以前の診断結果を見る」 | snapshot から即時表示 (AI 呼ばない) / Network tab で `/api/matching` 呼ばれない | A | ⬜ | |
| 19 | matching | partial fail amber banner | (一部 candidate のみ AI 失敗、再現が難しければ skip) | amber banner「一部候補の分析に失敗しましたが...」が ResultView 直上に表示 | B | ⬜ | STEP-API-MATCHING-01 |
| 20 | 小論文 | テーマ選択 → 添削 | `/essay-practice` でテーマ確認 → ミニ思考欄入力 → 本文 100 字以上 → AI壁打ち skip → 「AI添削する」 | LoadingProgress 表示 / 15-20 秒で添削結果表示 | A | ⬜ | essay-review API |
| 21 | 小論文 | dual-write 確認 | 添削後 DevTools で `essayPracticeReview` と `essayWorkspaces` を確認 | 両 key に保存されている (essay STEP B dual-write) | B | ⬜ | |
| 22 | 面接 | 質問生成 | `/interview/questions` で submit | LoadingProgress 表示 / 15-20 秒で 2 層 (general + personalized) 質問表示 | A | ⬜ | interview-questions API |
| 23 | 面接 | cache hit banner | 同じ素材で 2 回目 submit | LoadingProgress 出ない / 「以前生成した質問を再表示しています...」軽量 banner 表示 | A | ⬜ | PR8c (H6) |
| 24 | 面接 | history 表示 | `/interview/history` (record があれば) | 履歴 list 表示 | B | ⬜ | |
| 25 | tutor | 1 reply | `/tutor` で「テストです」等の non-emergency message 送信 | 「整理しています…」chat bubble → 3-10 秒で reply 表示 / daily limit 1 消費 | A | ⬜ | tutor API |
| 26 | tutor | emergency block | 「死にたい」「消えたい」等を入力 (test 用) | API 呼ばれず client-side で固定 reply (相談窓口案内) / daily limit 消費しない | S | ⬜ | EMERGENCY_PATTERN |
| 27 | 全体 | no native alert | 上記 #01-#26 で `alert()` modal が一度も出ないこと | native alert 0 回 | S | ⬜ | project-wide alert ゼロ |
| 28 | 全体 | no native confirm (主要 flow) | 上記 #01-#26 で `window.confirm()` modal が一度も出ないこと (※`/components/activity/*` の活動削除 / `/interview/history` の練習記録削除は既知 A-05 残として除外) | 上記 flow で native confirm 0 回 | A | ⬜ | STEP-UX-FIX-04 範囲 |
| 29 | 全体 | no console fatal | DevTools Console が #01-#26 で error / warning なし (dev 由来 noise は除く) | console.error 0 件 | S | ⬜ | |
| 30 | 全体 | no hydration mismatch | reload で `Text content did not match` 系 error が出ない | hydration error 0 件 | S | ⬜ | |
| 31 | mobile | layout quick check | 375x812 viewport で #01 / #09 / #15 / #25 を視認 | テキスト切れ・横スクロール・button 重なり・絶対位置崩れなし | A | ⬜ | A-11 sticky bar 未対応は除外 |
| 32 | mobile | cancel button tap | mobile viewport で #12 / #16 の cancel button が指で押せるサイズ | tap target 44px+、誤タップしない | A | ⬜ | STEP-UX-FIX-06d |

合計 **32 項目**。実施所要時間: 約 60-90 分 (1 人 1 ブラウザ)。

---

## 4. 実施記録テンプレート

別 doc (`release_smoke_test_results_NN.md`) に以下形式で記録する:

```markdown
# Release Smoke Test Results NN

実施日時: YYYY-MM-DD HH:MM
実施者: (name)
build commit: <git sha>
本番 URL: <url>
browser: Chrome 132 (macOS) / Safari iOS 18 (iPhone 13)

## Summary
- pass: X / fail: Y / skip: Z
- S blocker fail: 0 件 / N 件
- release 判定: Go / No-Go

## 詳細
(本 doc §3 の表をコピーして結果列 / 備考列に記入。fail は手順を再現できる詳細を書く)

## 異常時対応 (§5)
- (該当時のみ)
```

---

## 5. 異常時の severity 基準

| severity | 意味 | 対応 |
|---|---|---|
| **S** | release blocker。core flow が壊れる / data loss / cost spike / security | **release stop**。修正完了まで release しない |
| **A** | UX 強く損なう / 一部ユーザーが詰まる | release **前に修正推奨**。難しければ explicit な「known issue」として release notes に明記し timeline を出す |
| **B** | 違和感はあるが flow は完走できる / edge case | release **後の品質向上** で十分 |
| **C** | backlog 候補 | issue 化のみ |

判定の目安:
- core navigation が動かない / save 失敗 / AI 失敗で結果を取り戻せない = **S**
- 一部 button が反応しない / mobile で見切れる / hydration mismatch = **A**
- スタイルの軽い崩れ / 文言の typo / 非中核 flow のエラーハンドリング不足 = **B**

---

## 6. 完了条件 (release Go の最低ライン)

以下を **すべて** 満たすこと:

- [ ] **S fail = 0 件** (本 doc §3 の S 項目すべて pass)
- [ ] **A fail = 0 件 or 全件に release notes / 後続 STEP の明示** (修正困難なら known issue 化)
- [ ] **`npx tsc --noEmit` clean** (smoke test 実施 build と同じ commit で確認)
- [ ] **`npx eslint app components hooks` 0 errors / 0 warnings**
- [ ] **AI route がすべて HTTP 200 を返した** (network tab で確認、5xx / timeout なし)
- [ ] **mobile quick check (#31, #32) pass**
- [ ] **no native alert (#27)**
- [ ] **no console fatal error (#29)**
- [ ] **no hydration mismatch (#30)**

満たさない場合は §5 の severity に従って **release stop / 後続 STEP 作成**。

---

## 7. 観測項目の不変条件

本 smoke test を実施・更新するときは:

- runtime code を変更しない（手順書は記録のみ）
- 既出 doc (`release_qa_pass_01.md`, `../ux/ux_audit_phase1.md`, `../principles/cleanup_phase_summary.md`) の判定と矛盾しない
- PROMPT_VERSION / cache identity / storage 形式 は不変
- production env に **test だけのために特殊 flag** を立てない (常用環境で再現できないテストは smoke として価値がない)

矛盾を見つけたら **対応する audit doc を先に直し、本 doc は同期する**。

---

## 8. 関連 doc

- [`release_qa_pass_01.md`](./release_qa_pass_01.md) — 静的 QA pass (本 smoke test の前提となる static review)
- [`../ux/ux_audit_phase1.md`](../ux/ux_audit_phase1.md) — UX audit 正本 (§14 が実施結果サマリ)
- [`../principles/cleanup_phase_summary.md`](../principles/cleanup_phase_summary.md) — フェーズ全体 summary (§8b に UX fix フェーズ)
- [`../observability/api_observability_audit.md`](../observability/api_observability_audit.md) — API 観測項目 (release 後 monitoring の前提)
- [`../principles/ai_cache_observability.md`](../principles/ai_cache_observability.md) — cache hit / miss の確認手段
- [`../principles/feedback_dev_principles.md`](../principles/feedback_dev_principles.md) — 開発方針
