# Release Smoke Test Results — (Template)

> このファイルは **テンプレート** です。実施時は `release_smoke_test_results_NN.md` (NN = 連番) としてコピーし、`(...)` 部分を実値で埋めて commit してください。本テンプレ自体は更新しないでください（テンプレ改訂時のみ別 commit）。

対応する手順書: [`release_smoke_test_01.md`](./release_smoke_test_01.md)
対応する static QA: [`release_qa_pass_01.md`](./release_qa_pass_01.md)

---

## 0. 実施 summary

| 項目 | 値 |
|---|---|
| 実施日時 | YYYY-MM-DD HH:MM (timezone) |
| 実施者 | (name) |
| production URL | https://(...) |
| build commit (`git sha`) | (...) |
| build 方法 | `npm run build && npm start` / Vercel preview / Vercel production |
| env 種別 | production / staging |
| 主ブラウザ | Chrome XXX (macOS XX.X) |
| 副ブラウザ (mobile) | Safari iOS XX / Android Chrome XXX |
| viewport (mobile 確認) | 375 × 812 (実機) or DevTools Responsive |
| 所要時間 | XX 分 |

### 0.1. 結果 totals

| 区分 | 件数 |
|---|---|
| total | 32 |
| ✅ PASS | (N) |
| ❌ FAIL | (N) — うち S: (n) / A: (n) / B: (n) / C: (n) |
| ⏭ SKIP | (N) |

### 0.2. release decision (preliminary)

§3 final decision 欄で **最終確定**。本欄は速報用。

- [ ] **GO** — S fail = 0、A fail = 0、完了条件 (smoke_test_01.md §6) を全て満たす
- [ ] **GO WITH NOTES** — S fail = 0、A fail はあるが release notes / 後続 STEP で明示済み
- [ ] **NO-GO** — S fail ≥ 1

---

## 1. fail 記録ルール

### 1.1. severity による対応

| severity | 対応 |
|---|---|
| **S fail** | **NO-GO** 確定。release stop して修正 → 該当項目 + 影響範囲を **必ず再実施** |
| **A fail** | 原則 release 前に修正 → 再実施。修正が困難な場合のみ release notes + 後続 STEP 作成で「GO WITH NOTES」に倒す（§3 で justification 必須） |
| **B fail** | release 後の品質向上 STEP として backlog 化（実 issue 番号 or STEP 名を §3 unresolved 欄に記載） |
| **C fail** | backlog のみ |

### 1.2. fail 記録の必須情報

各 fail について以下を **必ず** 記入:

- 再現手順 (短く / 1-3 step)
- 期待結果と実際の差分
- console error / network error の有無 (DevTools スクショ推奨)
- screenshot / video evidence のパス (リポジトリ外でよいが URL or 共有 link を残す)
- severity 判定の根拠 (smoke_test_01.md §5 の基準と照合)
- follow-up issue / STEP 名 (B/C で release を見送らない場合は必須)

### 1.3. SKIP の許容条件

「再現困難で SKIP」 した場合は以下を備考に記載:
- なぜ再現できなかったか (例: partial fail 状態の人為的作出が困難)
- 代替確認手段 (例: static code review で confirmation 済み、参照 commit)
- リスク評価 (release blocker になり得るか)

---

## 2. 詳細結果

判定凡例: ✅ PASS / ❌ FAIL / ⏭ SKIP
device 略号: PC = desktop main browser / MB = mobile (実機 or DevTools Responsive) / — = N/A

### 2.1. 初回導線

| # | 項目 | severity | result | device | notes / evidence |
|---|---|---|---|---|---|
| 01 | Landing 表示 | S | ⏭ | PC | (...) |
| 02 | 基本情報入力 → Home | S | ⏭ | PC | (...) |
| 03 | Home nextFeature 表示 | S | ⏭ | PC | (...) |
| 04 | Home → 自己分析 hub | A | ⏭ | PC | (...) |

### 2.2. 自己分析

| # | 項目 | severity | result | device | notes / evidence |
|---|---|---|---|---|---|
| 05 | 活動入力 → 分析開始 (analysis API) | S | ⏭ | PC | response time: ____ sec |
| 06 | 深掘り → 活動まとめ生成 (summarize API) | S | ⏭ | PC | response time: ____ sec |
| 07 | 結果画面 → 自己PR 導線 | A | ⏭ | PC | (...) |

### 2.3. 志望理由書

| # | 項目 | severity | result | device | notes / evidence |
|---|---|---|---|---|---|
| 08 | 整理する → 書く 導線 | A | ⏭ | PC | (...) |
| 09 | 添削開始 (statement-review API) | S | ⏭ | PC | response time: ____ sec |
| 10 | next-action bar (3 button) | A | ⏭ | PC | (...) |
| 11 | draft save toast (no native alert) | S | ⏭ | PC | (...) |
| 12 | LoadingProgress cancel | S | ⏭ | PC | cancel 後 loading 残らない? Y/N |
| 13 | cache hit (2 回目 同入力 で spinner 出ない) | A | ⏭ | PC | Network tab で `/api/statement-review` 呼ばれない? Y/N |
| 14 | history delete ConfirmDialog | A | ⏭ | PC | native confirm 出ない? Y/N |

### 2.4. matching

| # | 項目 | severity | result | device | notes / evidence |
|---|---|---|---|---|---|
| 15 | 診断開始 (matching API) | S | ⏭ | PC | response time: ____ sec |
| 16 | LoadingProgress cancel | S | ⏭ | PC | cancel 後 ConfirmView に留まる? Y/N |
| 17 | 失敗時 inline banner (red) | A | ⏭ | PC | 再現困難なら SKIP 可、§1.3 参照 |
| 18 | cached result 表示 | A | ⏭ | PC | `/api/matching` 呼ばれない? Y/N |
| 19 | partial fail amber banner | B | ⏭ | PC | 再現困難なら SKIP 可、§1.3 参照 |

### 2.5. 小論文

| # | 項目 | severity | result | device | notes / evidence |
|---|---|---|---|---|---|
| 20 | テーマ選択 → 添削 (essay-review API) | A | ⏭ | PC | response time: ____ sec |
| 21 | dual-write 確認 (essayPracticeReview + essayWorkspaces) | B | ⏭ | PC | DevTools Application で両 key 存在? Y/N |

### 2.6. 面接

| # | 項目 | severity | result | device | notes / evidence |
|---|---|---|---|---|---|
| 22 | 質問生成 (interview-questions API) | A | ⏭ | PC | response time: ____ sec |
| 23 | cache hit banner (2 回目 同入力) | A | ⏭ | PC | 軽量 banner 表示? Y/N |
| 24 | history 表示 | B | ⏭ | PC | (...) |

### 2.7. tutor

| # | 項目 | severity | result | device | notes / evidence |
|---|---|---|---|---|---|
| 25 | 1 reply (tutor API) | A | ⏭ | PC | response time: ____ sec |
| 26 | emergency block (client-side) | S | ⏭ | PC | API 呼ばれない? Y/N (Network tab で確認) / daily limit 消費しない? Y/N |

### 2.8. 全体

| # | 項目 | severity | result | device | notes / evidence |
|---|---|---|---|---|---|
| 27 | no native alert (主要 flow 全体で 0 回) | S | ⏭ | PC | alert 発火回数: ___ |
| 28 | no native confirm (主要 flow、A-05 残 10 件除外) | A | ⏭ | PC | confirm 発火回数: ___ |
| 29 | no console fatal (error / warning) | S | ⏭ | PC | error 件数: ___ / warning 件数: ___ |
| 30 | no hydration mismatch | S | ⏭ | PC | "Text content did not match" 等の有無 |

### 2.9. mobile

| # | 項目 | severity | result | device | notes / evidence |
|---|---|---|---|---|---|
| 31 | layout quick check (#01 / #09 / #15 / #25) | A | ⏭ | MB | テキスト切れ / 横スクロール / 重なり? |
| 32 | cancel button tap (#12 / #16) | A | ⏭ | MB | 44px+ tap target で誤タップなし? Y/N |

---

## 3. final decision (実施完了後に記入)

### 3.1. release decision

- [ ] **GO**
- [ ] **GO WITH NOTES** (理由を 3.3 unresolved に記載)
- [ ] **NO-GO** (理由を 3.2 blocker に記載)

decision 確定日時: YYYY-MM-DD HH:MM

### 3.2. release blocker (S fail) 一覧

| # | 項目 | 概要 | 再現手順 | 修正 STEP / commit |
|---|---|---|---|---|
| (n) | (...) | (...) | (...) | (...) |

S fail = 0 件なら本表は「該当なし」と記入。

### 3.3. unresolved issues (A / B / C fail + SKIP の justification)

| # | 項目 | severity | result | follow-up |
|---|---|---|---|---|
| (n) | (...) | A | FAIL | release notes 記載 + STEP-XXX で対応 (target: YYYY-MM-DD) |
| (n) | (...) | B | FAIL | backlog: issue #XXX |
| (n) | (...) | — | SKIP | 再現困難、static review で代替確認済 (commit XXX) |

unresolved 0 件なら「該当なし」と記入。

### 3.4. 完了条件チェック (smoke_test_01.md §6 と一対一)

- [ ] S fail = 0 件
- [ ] A fail = 0 件 (or unresolved 欄に release notes / STEP 明示)
- [ ] `npx tsc --noEmit` clean (build commit で確認)
- [ ] `npx eslint app components hooks` 0 errors / 0 warnings
- [ ] AI route すべて HTTP 200 (5xx / timeout なし)
- [ ] mobile quick check (#31, #32) pass
- [ ] no native alert (#27) pass
- [ ] no console fatal (#29) pass
- [ ] no hydration mismatch (#30) pass

すべてチェックなら **GO**。1 つでも未チェック かつ S fail → **NO-GO**。S fail = 0 だが A 残あり → **GO WITH NOTES** で justification を 3.3 に記録。

### 3.5. next action

| 順 | action | owner | timing |
|---|---|---|---|
| 1 | (...) | (name) | (date) |
| 2 | (...) | (name) | (date) |

例:
- 「GO」: deploy → release 直後 24h monitoring → 1 week retention review
- 「GO WITH NOTES」: release → 同時に follow-up STEP 着手 → 1 週間以内に再 smoke test
- 「NO-GO」: 該当 S fail を直す STEP 作成 → 修正後に本テンプレを新規 NN として再実施

### 3.6. sign-off

| role | name | date | 同意 |
|---|---|---|---|
| 実施者 | (...) | (...) | ☐ |
| review (project owner) | (...) | (...) | ☐ |
| release responsible | (...) | (...) | ☐ |

sign-off の意味: 「本 doc の判定 (3.1) と完了条件 (3.4) を確認し、release を実行することに同意する」。NO-GO の場合は「修正 STEP に着手することに同意する」と読み替える。

---

## 4. 観測項目の不変条件

本テンプレを使った記録 doc を更新するときは:

- 結果記入は **実施時 1 回限り** を原則とする (追記は §3.5 next action / §3.3 unresolved の進捗のみ)
- 過去の result を後付けで書き換えない (再実施は別 NN として新規 doc 化)
- runtime code を変更しない (本 doc は記録のみ)
- 既出 doc (`release_smoke_test_01.md`, `release_qa_pass_01.md`, `../ux/ux_audit_phase1.md`, `../principles/cleanup_phase_summary.md`) と矛盾しない

---

## 5. 関連 doc

- [`release_smoke_test_01.md`](./release_smoke_test_01.md) — 手順書 (32 項目の正本)
- [`release_qa_pass_01.md`](./release_qa_pass_01.md) — 静的 QA pass (smoke test の前提)
- [`../ux/ux_audit_phase1.md`](../ux/ux_audit_phase1.md) — UX audit 正本
- [`../principles/cleanup_phase_summary.md`](../principles/cleanup_phase_summary.md) — フェーズ全体 summary
- [`../observability/api_observability_audit.md`](../observability/api_observability_audit.md) — release 後 monitoring 観点
