# Release Smoke Test Results 01 — STEP-RELEASE-SMOKE-01（部分実施）

対応する手順書: [`release_smoke_test_01.md`](./release_smoke_test_01.md)
対応する static QA: [`release_qa_pass_01.md`](./release_qa_pass_01.md)
凍結境界: [`freeze.md`](./freeze.md)

---

## 0. 実施 summary

| 項目 | 値 |
|---|---|
| 実施日時 | 2026-05-30 (JST)（静的検証部分）／**ブラウザ実施分は未実施** |
| 実施者 | Claude（静的検証）／**人間ブラウザ smoke 担当者: 未割当** |
| production URL | **未起動**（`npm run build && npm start` 実施待ち） |
| build commit (`git sha`) | `821d845 Harden release cleanup boundaries` |
| build 方法 | 静的検証のみ。production build 起動なし |
| env 種別 | — |
| 主ブラウザ | — |
| 副ブラウザ (mobile) | — |
| viewport (mobile 確認) | — |
| 所要時間 | 静的検証 5 分／ブラウザ smoke 未実施 |

### 0.1. 結果 totals

| 区分 | 件数 |
|---|---|
| total | 34（手順書 #01–#34） |
| ✅ PASS | 2（#27 no native alert / #28 no native confirm in main flow） |
| ❌ FAIL | 0 |
| ⏭ SKIP | 32（**browser execution required**：本セッションでは観測不可） |

§6 完了条件のうち静的サブ項目:

| 項目 | 結果 |
|---|---|
| `npx tsc --noEmit` clean | ✅ PASS |
| `npx eslint app components hooks` 0 errors / 0 warnings | ✅ PASS |
| AI route HTTP 200 全成功 | ⏭ SKIP（browser + API call 必要） |
| mobile quick check (#31, #32) | ⏭ SKIP |
| no native alert (#27) | ✅ PASS |
| no console fatal (#29) | ⏭ SKIP（browser 必要） |
| no hydration mismatch (#30) | ⏭ SKIP（browser 必要） |

### 0.2. release decision (preliminary)

§6 final decision 欄で **最終確定**。本欄は速報用。

- [ ] **GO**
- [ ] **GO WITH NOTES**
- [ ] **NO-GO**
- [x] **PENDING** — 静的検証のみ完了。**ブラウザ実機 smoke が未実施のため Go/No-Go 判定不可**。S/A の fail 有無は実機 smoke 完了後に確定する。

---

## 1. 本セッションの制約と方針

本 STEP は AI agent (Claude) が直接 smoke を実行する依頼として起票されたが、以下の構造的制約により **agent 単独では完了できない** ことが判明したため、**静的検証部分のみ実施**し、ブラウザ依存項目は SKIP として記録した。

### 1.1. 制約

1. **本セッションにブラウザ自動化ツール無し**（Playwright / Puppeteer / MCP browser tool いずれも未配備）。Landing 200 / hydration / LoadingProgress / cancel button / mobile layout / toast 表示 等の視覚観察は不可。
2. **AI route 実行は事前承認必須**（auto-memory `feedback_api_cost_approval.md`）。#05 analysis / #06 summarize / #09 statement-review / #15 matching / #20 essay-review / #22 interview-questions / #25 tutor は API コストが発生するため、本 STEP の指示文だけでは未承認扱い。
3. **「未確認のまま pass 扱い」禁止**（[`release_qa_pass_01.md`](./release_qa_pass_01.md) §10）。fabricate PASS は release 判定を誤らせるため厳禁。

### 1.2. 採用方針（user confirmed via AskUserQuestion）

- **静的検証可能な項目だけ PASS** として記録（#27, #28, §6 tsc / eslint）
- **ブラウザ観察が必要な項目はすべて ⏭ SKIP** とし、SKIP 理由を `browser execution required` で明示
- **GO/NO-GO は出さず PENDING**。実機 smoke 完了後に人間 reviewer が判定する想定
- 本 doc は実機 smoke 担当者が SKIP → PASS / FAIL に置き換えていく **作業フレーム** としても機能する

---

## 2. checklist 結果

severity 凡例: **S** = release blocker / **A** = release 前修正推奨 / **B** = release 後修正可 / **C** = backlog
判定凡例: ✅ PASS / ❌ FAIL / ⏭ SKIP

| # | category | 項目 | severity | 結果 | 備考 |
|---|---|---|---|---|---|
| 01 | 初回導線 | Landing 表示 | S | ⏭ SKIP | browser execution required（`/` への HTTP 200 + hero 表示 + hydration error 無の視覚確認） |
| 02 | 初回導線 | 基本情報入力 → Home | S | ⏭ SKIP | browser required（入力 / `saveBasicInfo()` / redirect 観察） |
| 03 | 初回導線 | Home nextFeature 表示 | S | ⏭ SKIP | browser required |
| 04 | 初回導線 | Home → 自己分析 hub | A | ⏭ SKIP | browser required |
| 05 | 自己分析 | 活動入力 → 分析開始 | S | ⏭ SKIP | browser + AI call（API コスト発生、事前承認必要） |
| 06 | 自己分析 | 深掘り → 活動まとめ生成 | S | ⏭ SKIP | browser + AI call |
| 07 | 自己分析 | 結果画面 → 自己PR 導線 | A | ⏭ SKIP | browser required |
| 08 | 志望理由書 | 整理する → 書く 導線 | A | ⏭ SKIP | browser required |
| 09 | 志望理由書 | 添削開始 | S | ⏭ SKIP | browser + AI call |
| 10 | 志望理由書 | next-action bar | A | ⏭ SKIP | browser required |
| 11 | 志望理由書 | draft save toast | S | ⏭ SKIP | browser required（toast 視覚観察） |
| 12 | 志望理由書 | LoadingProgress cancel | S | ⏭ SKIP | browser + AI call |
| 13 | 志望理由書 | cache hit (2 回目同入力) | A | ⏭ SKIP | browser + Network tab 観察 |
| 14 | 志望理由書 | history delete ConfirmDialog | A | ⏭ SKIP | browser required |
| 15 | matching | 診断開始 | S | ⏭ SKIP | browser + AI call |
| 16 | matching | LoadingProgress cancel | S | ⏭ SKIP | browser + AI call |
| 17 | matching | 失敗時 inline banner | A | ⏭ SKIP | browser + network 切断再現 |
| 18 | matching | cached result 表示 | A | ⏭ SKIP | browser required |
| 19 | matching | partial fail amber banner | B | ⏭ SKIP | browser + 一部 candidate fail 再現 |
| 20 | 小論文 | テーマ選択 → 添削 | A | ⏭ SKIP | browser + AI call |
| 21 | 小論文 | dual-write 確認 | B | ⏭ SKIP | browser + DevTools localStorage 観察 |
| 22 | 面接 | 質問生成 | A | ⏭ SKIP | browser + AI call |
| 23 | 面接 | cache hit banner | A | ⏭ SKIP | browser + AI call |
| 24 | 面接 | history 表示 | B | ⏭ SKIP | browser required |
| 25 | tutor | 1 reply | A | ⏭ SKIP | browser + AI call（daily limit 1 消費） |
| 26 | tutor | emergency block | S | ⏭ SKIP | browser required（API 呼ばれず client-side reply 観察） |
| 27 | 全体 | no native alert | S | ✅ PASS | **静的検証**: `grep -rn "\balert(" app components hooks lib` で runtime コードに live `alert()` 0 件。残存は `app/admission-matching/page.tsx` / `app/statement/edit/page.tsx` のコメント内のみ（STEP-QA-FIX-01 / STEP-UX-FIX-01 で置換済）|
| 28 | 全体 | no native confirm (主要 flow) | A | ✅ PASS | **静的検証**: `grep` で `window.confirm(` 11 件検出、すべて **既知 A-05 残として除外** scope (`/app/interview/history` × 1 + `components/activity/*` × 10) に該当。主要 flow には 0 件 |
| 29 | 全体 | no console fatal | S | ⏭ SKIP | browser DevTools Console 観察必要 |
| 30 | 全体 | no hydration mismatch | S | ⏭ SKIP | browser reload + `Text content did not match` 系 error 観察必要 |
| 31 | mobile | layout quick check | A | ⏭ SKIP | 375x812 viewport 視覚確認必要 |
| 32 | mobile | cancel button tap | A | ⏭ SKIP | 実機タップ確認必要 |
| 33 | 面接 | 質問生成失敗時 fallback notice | A | ⏭ SKIP | browser + `/api/interview-questions` block 再現必要（STEP-CODE-CLEANUP-A4 検証） |
| 34 | 面接 | フィードバック生成失敗時 fallback notice | A | ⏭ SKIP | browser + `/api/interview-feedback` block 再現必要（STEP-CODE-CLEANUP-A4 検証） |

### 静的検証コマンド再現性

```bash
# #27
grep -rn "\balert(" app components hooks lib | grep -v "//\|/\*\|\*\|\.test\.\|\.spec\." 
# → 0 件

# #28
grep -rn "window\.confirm\|\bconfirm(" app components hooks lib | grep -v "//\|\.test\.\|\.spec\.\|confirmDelete\|ConfirmDialog\|confirm: "
# → 11 件、全て activity セクション + interview/history（既知の除外 scope）

# §6 tsc / eslint
npx tsc --noEmit                              # → clean
npx eslint app components hooks lib types     # → clean
```

---

## 3. Human Reviewer Worksheet（実機 smoke 32 項目）

§2 の SKIP 32 項目を **severity（S → A → B）+ ユーザーフロー順** に並べ替え、各項目に URL / 入力データ / 手順 / PASS 条件 / AI API 呼び出し有無 / コスト発生 を追加した実機作業シート。実施した項目から §2 表の該当行を ✅ PASS / ❌ FAIL に上書きする。

### 3.0. 共通

- **本番 URL**（実値で置換）: `https://(...)` ※ commit `821d845` の build を指す
- **FAIL 検出時の記録**: §5 に以下形式で追記
  ```
  ## #NN [S/A/B] (項目名)
  再現手順: (steps)
  期待挙動: (expected)
  実際挙動: (actual)
  重大度: S / A / B / C
  ```
- **AI API 凡例**:
  - ⚠️ **Yes** = 実 AI 呼び出しが発生（**実施前に承認必要**、コスト発生）
  - 🚫 **No (expected cache hit)** = キャッシュ復元想定、API 呼ばれない（Network tab で確認）
  - 🚫 **No (expected block)** = client-side で API 到達前に弾かれる想定（#26 / cache hit 系）
  - 🟡 **Attempted but blocked** = network manipulation で fetch 自体を遮断（コスト最小〜ゼロ）
  - ➖ **N/A** = AI とは無関係（routing / UI / static）

---

### 3.1. S 項目（release blocker・最優先）

#### #01 [S] Landing 表示
- **URL**: `/`
- **手順**: 本番 URL を開く。DevTools Console と Network を開いておく
- **PASS**: HTTP 200 / hero 表示あり / Console に hydration error 出ない
- **AI API**: ➖ N/A ／ **コスト**: なし

#### #02 [S] 基本情報入力 → Home
- **URL**: `/input/basic`
- **入力データ**: 大学＝「東京テスト大学」/ 学部＝「テスト学部」/ 学年＝高3 / 評定＝4.0 等の **個人特定不能な仮値**
- **手順**: 各項目入力 → 「次へ」
- **PASS**: DevTools Application > Local Storage に `basicInfo` key が保存される / `/home` に redirect される
- **AI API**: ➖ N/A ／ **コスト**: なし

#### #03 [S] Home nextFeature 表示
- **URL**: `/home`
- **手順**: #02 直後に Home へ遷移して観察
- **PASS**: 「今日やるべきこと」card が表示される（`getNextFeature(statuses)` の結果。基本情報直後は自己分析誘導の想定）
- **AI API**: ➖ N/A ／ **コスト**: なし

#### #05 [S] 活動入力 → 分析開始
- **URL**: `/input/activity` → `/self-analysis/run`
- **入力データ**: 部活動 1 件 + ボランティア 1 件（説明 / 役割 / 成果を各 50 字程度）
- **手順**: 活動入力 → 「AIに分析させる」
- **PASS**: LoadingProgress が経過秒 + sub-message rotate 付きで表示 → 約 20-30 秒で結果表示
- **AI API**: ⚠️ **Yes** ／ route: `/api/analysis` ／ **コスト**: 発生（**実施前に承認**）

#### #06 [S] 深掘り → 活動まとめ生成
- **URL**: `/self-analysis/run`（#05 の続き）
- **入力データ**: 深掘り質問 1-2 件に各 50-100 字で回答
- **手順**: 回答後「活動まとめを生成する」
- **PASS**: summarize LoadingProgress 表示 → `SummarySection` 表示 / DevTools で `studentProfile` key が保存される
- **AI API**: ⚠️ **Yes** ／ route: `/api/summarize` ／ **コスト**: 発生（**実施前に承認**）

#### #09 [S] 志望理由書 添削開始
- **URL**: `/statement/edit`
- **入力データ**: 大学＝#02 と同値 / 学部 / 本文 100 字以上（仮文）
- **手順**: 入力 → 「AI添削する」
- **PASS**: LoadingProgress 表示（経過秒 + sub-message）→ 約 15-20 秒で結果表示
- **AI API**: ⚠️ **Yes** ／ route: `/api/statement-review` ／ **コスト**: 発生（**実施前に承認**、daily limit 1 消費）

#### #11 [S] draft save toast（非 blocking 確認）
- **URL**: `/statement/edit`
- **手順**: 「下書きを保存する」をクリック
- **PASS**: 非 blocking toast「下書きを保存しました」が 3 秒で自然消滅 / native `alert()` は出ない
- **AI API**: ➖ N/A ／ **コスト**: なし

#### #12 [S] LoadingProgress cancel（statement-review）
- **URL**: `/statement/edit`
- **手順**: 添削開始 → 経過 5-10 秒で「キャンセル」button をクリック
- **PASS**: LoadingProgress 即消滅 / red error banner 出ない / 結果も出ない / loading 状態が残らない
- **AI API**: ⚠️ **Yes** ／ route: `/api/statement-review`（mid-flight abort）／ **コスト**: 発生（cancel しても abort までの処理は走る、**実施前に承認**）

#### #15 [S] matching 診断開始
- **URL**: `/admission-matching`
- **手順**: 「志望校マッチングをする」をクリック
- **PASS**: LoadingProgress 表示（約 30 秒）→ 結果画面（ResultView）表示
- **AI API**: ⚠️ **Yes** ／ route: `/api/matching`（候補大学ごとに複数 call）／ **コスト**: 発生（**実施前に承認、最も高コスト**）

#### #16 [S] matching LoadingProgress cancel
- **URL**: `/admission-matching`（#15 進行中）
- **手順**: #15 進行中に「キャンセル」をクリック
- **PASS**: LoadingProgress 消滅 / Confirm 画面に留まる / red error banner 出ない（AbortError 分岐）
- **AI API**: ⚠️ **Yes** ／ route: `/api/matching`（mid-flight abort）／ **コスト**: 発生（**実施前に承認**）

#### #26 [S] tutor emergency block
- **URL**: `/tutor`
- **入力データ**: テスト用フレーズ（「死にたい」「消えたい」等の EMERGENCY_PATTERN 該当）
- **手順**: 上記を入力 → 送信
- **PASS**: API 呼ばれず client-side で固定 reply（相談窓口案内）/ Network tab で `/api/tutor` 呼ばれない / daily limit を消費しない
- **AI API**: 🚫 **No (expected block)** ／ **コスト**: なし

#### #29 [S] no console fatal（全 flow 通し）
- **手順**: #01〜#26 を通して DevTools Console を開きっぱなしにする
- **PASS**: `console.error` 0 件（dev 由来 noise は除く）
- **AI API**: ➖ N/A（他項目に内包）／ **コスト**: 内包

#### #30 [S] no hydration mismatch
- **手順**: 各 page で hard reload (Cmd+Shift+R)
- **PASS**: `Text content did not match` / `Hydration failed` 系 error が出ない
- **AI API**: ➖ N/A ／ **コスト**: なし

---

### 3.2. A 項目（release 前修正推奨）

#### #04 [A] Home → 自己分析 hub
- **URL**: `/home` → `/self-analysis`
- **手順**: nextFeature CTA をクリック（基本情報直後は自己分析誘導の想定）
- **PASS**: `/self-analysis` 遷移 / SuggestionCard 表示
- **AI API**: ➖ N/A ／ **コスト**: なし

#### #07 [A] 自己分析結果画面 → 自己PR 導線
- **URL**: `/self-analysis/run` → `/self-pr?from=run`
- **手順**: #06 完了後「自己PR添削ページへ進む →」CTA をクリック
- **PASS**: `/self-pr?from=run` 遷移 / 既存 PR or 新規入力画面が表示
- **AI API**: ➖ N/A ／ **コスト**: なし

#### #08 [A] 志望理由書 整理する → 書く 導線
- **URL**: `/statement`
- **手順**: SuggestionCard の CTA をクリック
- **PASS**: `/statement/prepare` または `/statement/edit` に遷移
- **AI API**: ➖ N/A ／ **コスト**: なし

#### #10 [A] statement 添削結果 next-action bar
- **URL**: `/statement/edit`（#09 完了後）
- **手順**: 結果直下の 3 button を順にクリック
- **PASS**: ①「↑ 本文を修正する」で input section に scroll / ②「💾 別名で保存する」で toast / ③「📊 完成度スコアを見る →」で `/statement/score` 遷移
- **AI API**: ➖ N/A ／ **コスト**: なし

#### #13 [A] statement cache hit（同入力 2 回目）
- **URL**: `/statement/edit`
- **手順**: 同じ大学・本文で再度「AI添削する」
- **PASS**: LoadingProgress 出ない（spinner flash なし）/ 即座に結果表示 / Network tab で `/api/statement-review` 呼ばれない
- **AI API**: 🚫 **No (expected cache hit)** ／ **コスト**: なし（cache 復元のため）

#### #14 [A] statement history delete ConfirmDialog
- **URL**: `/statement/score`
- **手順**: 履歴削除アイコンをクリック
- **PASS**: native `confirm()` ではなく React `ConfirmDialog` modal 表示 /「キャンセル」で閉じる /「削除」で履歴削除
- **AI API**: ➖ N/A ／ **コスト**: なし

#### #17 [A] matching 失敗時 inline banner
- **URL**: `/admission-matching`
- **手順**: DevTools Network で `/api/matching` を **Block request URL** に設定 → 「志望校マッチングをする」
- **PASS**: red inline banner「マッチングに失敗しました。もう一度お試しください。」が ConfirmView 直上に表示 / native `alert()` 出ない
- **AI API**: 🟡 **Attempted but blocked** ／ **コスト**: 最小（fetch は試行されるが network で遮断）

#### #18 [A] matching cached result 表示
- **URL**: `/admission-matching`（#15 一度成功後）
- **手順**: 「以前の診断結果を見る」をクリック
- **PASS**: snapshot から即時表示 / Network tab で `/api/matching` 呼ばれない
- **AI API**: 🚫 **No (expected cache hit)** ／ **コスト**: なし

#### #20 [A] 小論文 テーマ選択 → 添削
- **URL**: `/essay-practice`
- **入力データ**: テーマ確認 → ミニ思考欄入力 → 本文 100 字以上（仮文）→ AI壁打ち skip
- **手順**: 「AI添削する」
- **PASS**: LoadingProgress 表示 / 15-20 秒で添削結果表示
- **AI API**: ⚠️ **Yes** ／ route: `/api/essay-review` ／ **コスト**: 発生（**実施前に承認**）

#### #22 [A] 面接 質問生成
- **URL**: `/interview/questions`
- **入力データ**: 自動入力済 or 大学・学部・入試方式
- **手順**: submit
- **PASS**: LoadingProgress 表示 / 15-20 秒で 2 層（general + personalized）質問表示
- **AI API**: ⚠️ **Yes** ／ route: `/api/interview-questions` ／ **コスト**: 発生（**実施前に承認**）

#### #23 [A] 面接 cache hit banner
- **URL**: `/interview/questions`
- **手順**: 同じ素材で 2 回目 submit
- **PASS**: LoadingProgress 出ない / 「以前生成した質問を再表示しています...」軽量 banner 表示
- **AI API**: 🚫 **No (expected cache hit)** ／ **コスト**: なし

#### #25 [A] tutor 1 reply
- **URL**: `/tutor`
- **入力データ**: 「テストです」等の non-emergency message
- **手順**: 送信
- **PASS**: 「整理しています…」chat bubble → 3-10 秒で reply 表示 / daily limit 1 消費
- **AI API**: ⚠️ **Yes** ／ route: `/api/tutor` ／ **コスト**: 発生（**実施前に承認、daily limit 1 消費**）

#### #33 [A] 質問生成失敗時 fallback notice（STEP-CODE-CLEANUP-A4）
- **URL**: `/interview/questions`
- **手順**: DevTools Network で `/api/interview-questions` を Block → submit
- **PASS**: LoadingProgress 終了後に **deterministic legacy 質問が表示** + Preview 上部に amber notice「AI質問の生成に失敗したため、標準質問に切り替えました。練習はこのまま続けられます。」/ red error banner 出ない /「さらに質問を生成」等の継続 UI は動作
- **AI API**: 🟡 **Attempted but blocked** ／ **コスト**: 最小

#### #34 [A] フィードバック生成失敗時 fallback notice（STEP-CODE-CLEANUP-A4）
- **URL**: `/interview/record`
- **入力データ**: 練習日 / 大学 / 質問・回答 1 件
- **手順**: DevTools Network で `/api/interview-feedback` を Block → submit
- **PASS**: spinner 終了後に **練習記録が保存** (`savedMessage` 緑 AlertBox + 履歴リンク表示) かつ amber AlertBox「AIフィードバックの生成に失敗したため、簡易フィードバックを表示しています。」が `apiError` 領域と `savedMessage` の間に表示 / 履歴ページから記録が見える
- **AI API**: 🟡 **Attempted but blocked** ／ **コスト**: 最小

#### #31 [A] mobile layout quick check
- **viewport**: 375 × 812（実機 or DevTools Responsive）
- **手順**: #01 / #09 / #15 / #25 の各 page で視認
- **PASS**: テキスト切れ / 横スクロール / button 重なり / 絶対位置崩れ なし
- **AI API**: ➖ N/A（他項目に内包）／ **コスト**: 内包

#### #32 [A] mobile cancel button tap
- **viewport**: 375 × 812
- **手順**: #12 / #16 の cancel button を指（実機）or マウス（DevTools）で押す
- **PASS**: tap target 44px+、誤タップしない
- **AI API**: ⚠️ **Yes**（#12 / #16 に内包）／ **コスト**: 内包

---

### 3.3. B 項目（release 後修正可）

#### #19 [B] matching partial fail amber banner
- **URL**: `/admission-matching`
- **手順**: 一部 candidate のみ AI 失敗を再現（DevTools で意図的に 1 候補だけ失敗させる、または skip）
- **PASS**: amber banner「一部候補の分析に失敗しましたが...」が ResultView 直上に表示
- **AI API**: ⚠️ **Yes (部分)** ／ route: `/api/matching` ／ **コスト**: 発生（**実施前に承認**、再現困難なら skip 可）

#### #21 [B] 小論文 dual-write 確認
- **URL**: `/essay-practice`（#20 完了後）
- **手順**: DevTools > Application > Local Storage で `essayPracticeReview` と `essayWorkspaces` を確認
- **PASS**: 両 key に同じ review entry が保存されている（essay STEP B dual-write）
- **AI API**: ➖ N/A（#20 に内包）／ **コスト**: 内包

#### #24 [B] 面接 history 表示
- **URL**: `/interview/history`
- **手順**: ページを開く（過去 record があれば）
- **PASS**: 履歴 list 表示
- **AI API**: ➖ N/A ／ **コスト**: なし

---

## 4. Human Reviewer Checklist（実行順）

実機 smoke を **上から下に順に実行** するためのチェックリスト。AI API 承認の意思決定ポイントを明示。

- [ ] **`npm run build`** が clean に通る（warning は許容、error 0）
- [ ] **`npm start`** で production server 起動（または Vercel preview URL を確認）
- [ ] **Chrome DevTools Console を開く**（全項目通して error / warning を観察）
- [ ] **Chrome DevTools Network tab を開く**（cache hit 系 #13 / #18 / #23 と block 系 #17 / #33 / #34 で参照）
- [ ] **Application > Local Storage** を空にする（初回ユーザー状態で開始）
- [ ] **mobile viewport を準備**（375 × 812 = DevTools Responsive or 実機）
- [ ] **§3.1 S 項目を実施**（13 件、うち AI API 必要は #05 / #06 / #09 / #12 / #15 / #16 の 6 件）
- [ ] **AI API 実行を承認する** — S 項目 #05 / #06 / #09 / #12 / #15 / #16 を実施する直前に明示承認（コスト発生）
- [ ] **§3.2 A 項目を実施**（16 件、うち AI API 必要は #20 / #22 / #25 の 3 件、partial 1 件 #19）
- [ ] **AI API 実行を承認する** — A 項目 #20 / #22 / #25 を実施する直前に明示承認
- [ ] **§3.3 B 項目を実施**（3 件、AI API は #19 のみ、再現困難なら skip）
- [ ] **§2 表の SKIP 行を PASS / FAIL に上書き**
- [ ] **§5 FAIL の詳細** に検出した FAIL を記録（§3.0 のフォーマットを使用）
- [ ] **§6 final decision** で GO / GO WITH NOTES / NO-GO を確定
- [ ] **§0.1 / §0.2** の集計と decision を §6 と整合させる
- [ ] 結果を commit（runtime code は変更しない、本 doc のみ）

### 4.1. AI API 実行の承認チェックポイント

下記の **3 関門** で明示的に承認を取る運用を推奨。承認が取れない場合は該当項目を skip とし、§6 で「AI flow 未実施」を明記して reviewer 判断とする。

| 関門 | 対象項目 | 影響 |
|---|---|---|
| **関門 1**（S 一括） | #05 analysis / #06 summarize / #09 statement-review / #12 cancel / #15 matching / #16 cancel | release blocker 経路。S fail = 0 を確認するため必須 |
| **関門 2**（A 一括） | #20 essay-review / #22 interview-questions / #25 tutor | A fail = 0 確認のため推奨。skip 時は known issue として release notes に記載 |
| **関門 3**（B / partial） | #19 matching partial fail | 再現困難な場合は skip 可 |

---

## 5. FAIL の詳細

本セッション（agent 実施分）では FAIL を 1 件も検出していない。実機 smoke 担当者が FAIL を発見した場合は §3.0 のフォーマットで本セクションに追記すること。

```
## #NN [S/A/B] (項目名)
再現手順:
期待挙動:
実際挙動:
重大度: S / A / B / C
```

---

## 6. final decision

**PENDING** — 静的検証で 2 項目 PASS、32 項目 SKIP（実機 smoke 待ち）。

### 6.1. GO/NO-GO 判定に必要な残作業

| 区分 | 担当 | 内容 |
|---|---|---|
| **必須** | 人間 reviewer | production build 起動 + 32 SKIP 項目の実機実施。AI route 6 種 (#05 / #06 / #09 / #15 / #20 / #22 / #25 / #33 / #34) のうち再現可能なものを実施 |
| **必須** | 人間 reviewer | DevTools Console (#29) / reload hydration (#30) / mobile viewport (#31, #32) の視覚観察 |
| **推奨** | 人間 reviewer | Network tab block で #17 / #19 / #33 / #34 の fail 経路再現 |

### 6.2. S/A/B/C fail 一覧（現時点）

- **S fail**: 0 件（静的検証範囲内では検出なし、ただし S 項目 #01–#03 / #05 / #06 / #09 / #11 / #12 / #15 / #16 / #26 / #29 / #30 は未実施）
- **A fail**: 0 件（A 項目 多数未実施）
- **B fail**: 0 件
- **C 記録**: 0 件

### 6.3. PENDING 状態の意味

- 静的検証で見つかった範囲では **release blocker は 0 件**。
- ただし「browser observation で見つかる種類の S blocker」（hydration mismatch、Landing 500、console fatal、cancel button 動作不全 等）は **未検出ではなく未観測**。
- したがって本 doc 単独では **release Go を出してはいけない**。人間 reviewer の実機 smoke で 32 SKIP を埋めてから判定する。

---

## 7. 改訂履歴

- 2026-05-30: STEP-RELEASE-SMOKE-01 — 初版作成。AI agent (Claude) による静的検証部分（2 PASS / 0 FAIL / 32 SKIP）を記録。Go/No-Go は PENDING で人間 reviewer 実機 smoke 待ち。
- 2026-05-30: STEP-RELEASE-SMOKE-HUMAN-01 — §3 Human Reviewer Worksheet（32 SKIP 項目を S→A→B 順に再整理、URL / 入力 / 手順 / PASS / AI API / コスト を付与）と §4 Human Reviewer Checklist（実行順 + AI API 承認関門 3 箇所）を追加。runtime コード不変、§2 表は不変、§6 final decision は引き続き PENDING。

---

## 8. 関連 doc

- [`release_smoke_test_01.md`](./release_smoke_test_01.md) — 手順書 (34 項目)
- [`release_qa_pass_01.md`](./release_qa_pass_01.md) — static QA pass
- [`release_smoke_test_results_template.md`](./release_smoke_test_results_template.md) — 結果テンプレート
- [`freeze.md`](./freeze.md) — リリース凍結境界
- [`../principles/api_error_inventory.md`](../principles/api_error_inventory.md) — #33 / #34 の根拠
