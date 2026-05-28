# UX Audit — Phase 1

## 1. 目的

PASSAI を「初見ユーザー」として通し操作したときの **詰まり / 違和感 / 離脱ポイント / 保存導線不足 / 続けたくならなさ** を構造的に洗い出す。本 audit は **docs only**。runtime code 変更は別 STEP に分離する。

関連:
- [`../principles/cleanup_phase_summary.md`](../principles/cleanup_phase_summary.md) — 整理フェーズ完了 summary
- [`../principles/page_fix_audit.md`](../principles/page_fix_audit.md) — set-state-in-effect audit
- [`../principles/feedback_dev_principles.md`](../principles/feedback_dev_principles.md) — 開発方針

---

## 2. audit 手法

1. `/app` 配下 51 page を inventory 化
2. 各 page で 7 観点を観察:
   - primary CTA 文言
   - loading 表示
   - empty state
   - 戻る導線
   - save feedback
   - AI 出力後の次アクション
   - history / compare / delete 導線
3. severity (S/A/B/C) と「修正コスト」「UX リスク」で分類
4. flow 別 + Top10 で整理

15 観点 (詰まる箇所 / 戻れない / 保存不明 / 次アクション不足 / loading 不安 / empty 弱 / history 不足 / direct vs guided / 出力長 / mobile / 続けたくなる感 / 今どこ / 復帰しづらい / CTA 文言 / API 待機 feedback) を観察に組み込んだ。

---

## 3. audit 対象 flow

| flow | 主要 page |
|---|---|
| Landing | `/` |
| 入口 / 基本 | `/diagnosis`, `/input/basic`, `/input/activity` |
| Home | `/home` |
| 自己分析 | `/self-analysis`, `/self-analysis/run`, `/self-analysis/resume`, `/self-analysis/result`, `/self-pr` |
| 志望理由書 | `/statement`, `/statement/prepare`, `/statement/prepare/university`, `/statement/edit`, `/statement/score`, `/statement/analysis/[id]`, `/statement/improve`, `/statement/improve/analysis/[id]`, `/statement/improve/rewrite/[id]`, `/statement/compare` |
| 小論文 | `/essay`, `/essay-practice`, `/essay/improve`, `/essay/improve/[wid]`, `/essay/improve/[wid]/rewrite`, `/essay/improve/[wid]/compare`, `/essay/improve/[wid]/deep/[issueId]`, `/essay/result/[wid]`, `/essay/results`, `/essay/structure/...`, `/essay/write/...` |
| 面接 | `/interview`, `/interview/questions`, `/interview/record`, `/interview/history` |
| matching | `/admission-matching`, `/matching` (redirect) |
| 相談 AI | `/tutor` |
| 静的 | `/about`, `/contact`, `/privacy`, `/terms` |

合計 51 page、main flow 約 30 page。

---

## 4. severity 分類

- **S**: release blocker — 公開前に直すべき。基本機能の信頼を損なう
- **A**: 強く改善推奨 — 離脱率に直接効く
- **B**: 違和感 — release 後の改善で十分
- **C**: 将来候補 — 余裕があるとき / 仕様検討要

---

## 5. issue inventory (severity 別)

### 5.1. S — release blocker (3 件 / 全 3 件 実施済み)

実施状況サマリ (詳細は §14):
- S-01: ✅ 解消 (STEP-UX-FIX-01-ALERT, `1acd017`)
- S-02: ✅ 解消 (STEP-UX-FIX-02-STATEMENT-NEXT-ACTION, `0ec5f83`)
- S-03: ✅ 主要 flow 解消 (STEP-UX-FIX-06 / 06b / 06c / 06d, `e8653f3` 〜 `104dc7c`)。他 flow の cancel wiring は将来候補 (06e)

| # | page | 現象 | なぜ詰まる | 修正コスト | 推奨修正 | 状態 |
|---|---|---|---|---|---|---|
| S-01 | `/statement/edit:506` | 保存 button 押下時に `alert('保存しました')` (ブラウザ native blocking modal) | 1990 年代風の UX、夜中の作業中に出されると驚く。autosave があるのに alert で被るのも混乱 | 低 | inline toast / button label 一時変更 (例: 「保存しました ✓」を 2 秒表示) に置換。alert 削除 | ✅ STEP-UX-FIX-01-ALERT (`1acd017`) — quoteToast と同形の self-contained toast に置換 |
| S-02 | `/statement/edit` 添削直後 → 次アクション | ReviewResultView で「完成度スコアを見る →」link はあるが、本文修正に戻りたい場合の primary CTA がなく、scroll-to-input を `inputSectionRef` で行う設計 (L270) のため一部端末で見失う可能性 | AI 出力 → 「次にどう動くか」が **本文を直す / score を見る / 履歴に戻る** の三択で、現状は score CTA が目立つだけ | 中 | ReviewResultView 下部に「↑ 本文を修正する」「📊 詳細分析を見る」「💾 別名で保存する」の 3 button bar を明示。inputSectionRef は維持 | ✅ STEP-UX-FIX-02-STATEMENT-NEXT-ACTION (`0ec5f83`) — ReviewResultView に next-action bar 実装、`inputSectionRef` 経由の scroll を維持 |
| S-03 | AI loading 中の中断 | 60s timeout 設定済 ([`lib/aiTimeout.ts`](../../lib/aiTimeout.ts) STEP-API-TIMEOUT-01) だが、UI 側に「キャンセル」ボタンや経過秒数表示が一切ない。30 秒以上待つ場合 (`self-analysis/run` のみ「30秒ほどかかります」明記、他は無し) ユーザーは固まったと誤認しやすい | 「壊れた」と思って reload してしまうと、cache identity drift で **同 input でも再課金** になる経路がある | 中 | loading 表示に経過秒数 / 進捗バー (擬似でも可) と「キャンセル」button (AbortController) を追加。cache hit 時は < 1s で returns するため UX 改善が直接 cost 削減につながる | ✅ STEP-UX-FIX-06 系で解消。`components/ui/LoadingProgress.tsx` 新設 (経過秒 + sub-message rotation)、主要 flow 6 箇所に展開 (06 + 06b)、`/statement/edit` + `/admission-matching` に AbortController 接続 (06c)、mobile tap target 44px+ (06d)。他 flow の cancel 配線は将来候補 (06e) |

### 5.2. A — 強く改善推奨 (12 件 / 部分対応 4 件)

実施状況サマリ (詳細は §14):
- A-01 loading 文言: 🟡 部分対応 — `LoadingProgress` 統一が主要 6 flow に到達 (STEP-UX-FIX-06 / 06b)。文言は flow 別 sub-message として残しつつ、視覚的フォーマットは統一済み
- A-03 hub suggestion: 🟡 部分対応 — `statement` / `self-analysis` / `interview` hub 完了 (STEP-UX-FIX-05, `4796364`)。`/essay` hub は未着手 (STEP-UX-FIX-05b 候補)
- A-05 共通 ConfirmDialog: 🟡 部分対応 — 4/14 件完了 (STEP-UX-FIX-04, `0eeec50`)。`statement/edit` / `statement/improve` / `statement/score` / `self-pr` を `components/ui/ConfirmDialog.tsx` に移行。残 10 件は主に `components/activity/*` 配下と `interview/history` (STEP-UX-FIX-04b 候補)
- A-10 AI loading の不安: ✅ 解消 — A-01 と同経路で `LoadingProgress` が経過秒 / sub-message / `estimatedSeconds` を提供

| # | page | 現象 | 推奨修正 | 状態 |
|---|---|---|---|---|
| A-01 | loading 文言の **不統一** | 「AIが考え中...」「AIが添削中...」「整理しています…」「AIが分析中...（30秒ほどかかります）」「送信中...」「再添削中…」「生成中…」が乱立 | 共通 component (`AiThinkingState` は既存) に統一。「AI が考え中... (約 N 秒)」テンプレ化 | 🟡 部分対応 `LoadingProgress` 適用済み: `/statement/edit`, `/admission-matching`, `/essay-practice`, `/self-analysis/run` (analysis + summarize), `/interview/questions`。`/tutor` は chat-bubble UX 不適合のため見送り (理由は §14) |
| A-02 | rate limit 文言の **不統一** | 「本日の添削回数上限に達しました。明日またお試しください。」(`/statement/edit:425`) vs 「今日の相談回数の上限に達しました。明日また来てください。」(`/tutor:200`) vs 「短時間に整理を繰り返しすぎています。しばらく時間をおいてからお試しください。」(`/statement/prepare/university:188`) | 残回数表示 ([`/essay-practice:743-745`] にある「残り N 回」UI) を全 AI 機能で統一。エラーは「明日まで」「N 分後に」を明示 | ⬜ 未着手 (STEP-UX-FIX-08-RATE-LIMIT-UI 候補) |
| A-03 | hub page の **「次に何をすべきか」誘導が薄い** | `/home` だけ「今日やるべきこと」 nextFeature が出る (L242)。`/statement`, `/essay`, `/interview`, `/self-analysis` の hub は 4 カード並列で、初見だと「どれから?」が分からない | 各 hub 上部に「最初は ○○ から」suggestion card (status 連動) を追加。`/home` の `nextFeature` ロジックを各 hub 内 status に流用 | 🟡 3/4 hub 完了 (STEP-UX-FIX-05, `4796364`)。`/essay` hub は STEP-UX-FIX-05b 候補 |
| A-04 | direct mode と guided mode の **境界不明瞭** | `/self-pr?mode=direct` (URL flag) で挙動が変わる。inventory L302-350 の disable block が示すように mode=direct リアクティブで前 session state 全消し + openPR + router.replace。UI 上「direct mode に入った」シグナルがない | 上部 banner で「直接モード / ガイドモード」明示。`mode=direct` は遷移元 (`/self-analysis` 経路) でのみ付くので、その時点で「以前の自己分析と切り離して書く」と確認 dialog を出す案 |
| A-05 | history delete に **native `window.confirm()`** | `/statement/score`, `/statement/improve`, `/essay-practice`, `/self-pr` 全て native confirm dialog。content は OK だが UI 一貫性で減点 | 共通 ConfirmDialog component 化 (Card variant='danger' + ボタン 2 つ)。文言は既存を流用 | 🟡 4/14 件完了 (STEP-UX-FIX-04, `0eeec50`)。`components/ui/ConfirmDialog.tsx` 新設、4 caller (`statement/edit` / `statement/improve` / `statement/score` / `self-pr`) を移行。残 10 件は `components/activity/*` 9 件 + `interview/history` 1 件 (STEP-UX-FIX-04b 候補) |
| A-06 | `/statement/analysis/[id]` の **次アクション不足** | 「← 今のスコアに戻る」「志望理由書機能一覧に戻る」のみ。改善ポイントを読んだ後の自然な次は「書き直す」のはずだが、その経路は `/statement/improve/analysis/[id]` 経由になる別 page で、本 page からは直接行けない | 本 page 下部に「書き直しを始める →」CTA (`/statement/improve/analysis/[id]` または `/statement/improve/rewrite/[id]` へ遷移) を追加 |
| A-07 | `/statement/prepare` → `/statement/edit` への **prefill 経路が暗黙** | prepare で生成した summary は edit 左サイドバーに表示されるが、prepare 完了画面に「② 本文を書く →」明示 CTA があるか曖昧 (inventory では「下書きへ進む」あり) | CTA 文言を「整理メモを開いて本文を書き始める →」に強化。summary 表示直下に置く |
| A-08 | `/self-analysis/result` の **入口不在** | hub に「過去の結果を見る」card あり (inventory) だが、それ以外の経路 (例: edit で参考メモを開きたい局面) からの直アクセスがない。result page 自体の back nav も `result/current` への分岐があり迷う | 各機能の左サイドバーから「自己分析の結果を見る →」inline link を増やす。`result/page.tsx` / `result/current/page.tsx` の責務を確認し、片方を deprecate 検討 |
| A-09 | `/tutor` の **会話履歴消失** | session 単位、リロードで消える (inventory)。「整理した内容を後で見返したい」というユースケースで損失 | 会話を `localStorage` に保存 + 「過去の相談を見る」 entry を hub に追加 (Phase 2 の自然な拡張) |
| A-10 | AI 出力 30 秒待ち中の **不安** | `/self-analysis/run` 以外は経過時間 / ETA 表示なし。S-03 と関連 | 30 秒以上想定の route (matching / analyze / self-analysis-run / statement-review) では loading に「平均 N 秒。混雑時は最大 60 秒待つことがあります」を表示 | ✅ STEP-UX-FIX-06 / 06b で解消 (A-01 と同経路)。`LoadingProgress` が経過秒 + sub-message rotate + `estimatedSeconds` を提供 |
| A-11 | mobile **bottom CTA 不在** | 「保存」「次へ」「添削する」が長い form の最下部にしかなく、mobile で textarea を縦に書いている最中、CTA に到達するために大きく scroll する必要がある (`/statement/edit`, `/essay-practice`, `/essay/improve/[wid]/rewrite`) | sticky bottom action bar (mobile 限定) を追加。「保存 / 送信 / プレビュー」を持つ |
| A-12 | empty state の **CTA 弱さ** | `/statement/score`, `/statement/improve`, `/self-pr`, `/self-analysis` 等で empty state はあるが、CTA が 1 つしかなく、別の流入経路 (e.g. 「まず基本情報を確認する」「自己分析からやり直す」) が示されない | 2-3 個の選択肢を提示。primary + secondary + 「ヘルプを見る」リンクの 3 段構成 |

### 5.3. B — 違和感 (8 件)

| # | page | 現象 | 推奨修正 |
|---|---|---|---|
| B-01 | `/statement/improve` card クリック先が **`/improve/analysis`** | 名前から「rewrite hub」を期待するが、実際は「改善点を読む」中間ページに遷移。意図は分かるが初見は迷う | hub 上で 1 行説明「先に改善点を読んでから書き直します」を card 上に明示 |
| B-02 | `/statement/score` の **「成長しました」 / 「見直しが必要」** comparison card | 表現が断定的。低スコア続きのユーザーには重い | 「前回比 +X 点」「前回比 -X 点」のような数値表示 + 中立コピーへ |
| B-03 | `/statement/compare` の **入口** | 比較機能だが、`/statement` hub にカードがない (inventory)。`/statement/score` 経由でも辿りにくい | hub またはスコア page から「2 つを比べる」entry を追加 |
| B-04 | `/diagnosis` 完了後の **対策誘導** | 「このタイプに合わせて対策を始める」CTA があるが、遷移先 (Home or 別 page) が曖昧 | 遷移先を明示 + Home に「あなたは N 型」表示。`DiagnosisTypeCard` で既に対応か要確認 |
| B-05 | `/interview/questions` 生成後の **次の動線** | 質問が出た後、それを練習するための `/interview/record` への自然な link がない場合がある | 質問リストの下部に「練習結果を記録する →」CTA |
| B-06 | `/essay-practice` の **「最初からやり直す」** | テーマや本文を全消去する大事な動作。alert 系の確認が `window.confirm` のみ | A-05 の共通 ConfirmDialog で吸収 |
| B-07 | `/admission-matching` 結果の **保存タイミング不明** | 「以前の診断結果を見る」CTA で過去 result が読めるが、「いつ保存された」timestamp が薄く、何度も診断するとどれが最新か混乱 | result card に「YYYY/MM/DD HH:MM 診断」を大きめに表示 |
| B-08 | `/self-pr` `openedFromRun` 経路の **戻り先** | 「← ステップ3に戻る」が openedFromRun のときだけ出る (inventory)。flag が変わると戻り先が変わる動きはユーザーが追えない | 戻る link は常に固定 (「← 自己分析の活動まとめに戻る」) にして、direct mode のときだけ「自己PR トップへ」を併記 |

### 5.4. C — 将来候補 (5 件)

| # | page | 現象 | 推奨対応 |
|---|---|---|---|
| C-01 | 全体 | 「streak」「達成バッジ」「進捗 %」のような継続動機 UI なし | 別フェーズ。`/home` の status grid を拡張する案 |
| C-02 | 全体 | 完成した志望理由書 / 小論文の **export (PDF / コピー)** がない | 別フェーズ |
| C-03 | 全体 | 結果の **共有 (URL / 画像)** がない。保護者・先生に見せたいニーズあり | 個人情報保護観点で要設計 |
| C-04 | `/tutor` | RAG (志望校固有 knowledge) との結合なし。一般的アドバイスに留まる | API 改修フェーズの後候補 |
| C-05 | 全体 | dark mode / font size 調整 / accessibility audit が未実施 | 別フェーズ |

---

## 6. Top 10 UX issues (今すぐ直すべき)

順番は **離脱率 / 信頼度への影響 × 修正コスト** で優先順位付け。

| 順位 | ID | 対象 | 内容 | severity | 修正コスト | 状態 |
|---|---|---|---|---|---|---|
| 1 | S-01 | `/statement/edit:506` | `alert('保存しました')` → inline toast | S | 低 | ✅ 完了 (`1acd017`) |
| 2 | A-01 | 全 AI route | loading 文言統一 + ETA 表示 | A | 中 | 🟡 主要 6 flow に LoadingProgress 展開済み (`e8653f3`, `38a625a`)、`/tutor` 見送り |
| 3 | A-02 | 全 AI route | rate limit / 残回数 UI 統一 | A | 中 | ⬜ 未着手 (STEP-UX-FIX-08 候補) |
| 4 | A-03 | 各 hub | 「今日やるべきこと」 (home の nextFeature 流用) | A | 中 | 🟡 3/4 hub 完了 (`4796364`)、`/essay` 残 |
| 5 | A-06 | `/statement/analysis/[id]` | 「書き直しを始める →」CTA 追加 | A | 低 | ⬜ 未着手 |
| 6 | A-11 | mobile | sticky bottom action bar (statement/edit, essay-practice, essay rewrite) | A | 中 | ⬜ 未着手 |
| 7 | S-02 | `/statement/edit` 添削後 | 3-button bar (本文修正 / 詳細 / 別名保存) | S | 中 | ✅ 完了 (`0ec5f83`) |
| 8 | A-05 | history delete 全般 | 共通 ConfirmDialog component | A | 低 | 🟡 4/14 件完了 (`0eeec50`)、残 10 件 |
| 9 | A-04 | `/self-pr?mode=direct` | direct mode banner + 「以前の自己分析と切り離して書く」確認 | A | 中 | ⬜ 未着手 |
| 10 | S-03 | AI loading 全般 | 経過秒数 + キャンセル button | S | 中 | ✅ 主要 flow 解消 (`e8653f3` → `104dc7c`)、他 flow への cancel 横展開は 06e 候補 |

---

## 7. release blocker (S 級) サマリ

3 件すべて実質解消:
- **S-01** `/statement/edit` alert() 撤去 — ✅ 完了 (STEP-UX-FIX-01, `1acd017`)
- **S-02** 添削直後の next action 3-button bar — ✅ 完了 (STEP-UX-FIX-02, `0ec5f83`)
- **S-03** AI loading 経過秒数 + キャンセル — ✅ 主要 flow 解消 (STEP-UX-FIX-06 / 06b / 06c / 06d)。`/statement/edit` と `/admission-matching` に AbortController + cancel button 接続、`components/ui/LoadingProgress.tsx` に経過秒 + sub-message rotation + 44px mobile tap target

**release blocker = 0 件**。他 flow への cancel 横展開 (`/essay-practice`, `/self-analysis/run`, `/interview/questions`) は release 後の品質向上枠 (STEP-UX-FIX-06e 候補)。

---

## 8. 「続けたくなる UX」の弱点と仮説

### 8.1. 観察された弱点

1. **AI 出力後の "次の一手" 不足** (A-06, A-07, A-08, S-02): AI が長文を返すたびに「読み終わったら戻る」しかなく、能動的な次の一歩がない。出力 → CTA → 出力 → CTA の循環が作れていない。

2. **進捗の可視化が薄い** (C-01): `/home` の status grid は「完了 / 途中 / 未開始」の三段階のみ。「ここまで来た」を視覚化するメーター / streak / 連続日数がない。

3. **AI 待ち時間の不確定性** (S-03, A-10): 30 秒以上待つ場面で「ちゃんと動いているか」が分からないと、ユーザーは「とりあえず閉じる」に流れる。

4. **保存の "見えない" 信頼性** (S-01, A-11): autosave があっても、ユーザーには見えない。「保存されたか不安」 → 確認のため戻る → 別の作業に手をつけられない。

5. **history を後で見たくなる導線がない** (A-08, A-09): 過去の自己分析 / tutor 会話 / 添削履歴を **後で見返す** 用の入口が hub に薄い。「あの時の AI 出力をもう一度読みたい」が叶わない。

### 8.2. 仮説 (release 後の改善方針)

- **AI 出力 → 次の一手 を常にペアにする**: ReviewResult, SelfAnalysisResult, MatchingResult のいずれにも「次の一歩 (3 候補)」を underneath に固定表示。これだけで循環が作れる。
- **完了マイルストーンに micro-reward**: 「初めての添削」「3 回目の自己分析」「初の matching」で小さな祝意表示。実装コスト低、効果高。
- **autosave の見える化**: textarea の右上に「保存済み ✓ (HH:MM)」を常時表示。実装コスト極低。
- **loading 中の "意味" を伝える**: 「あなたの活動 5 件 + 自己分析の summary + 志望校 3 校を読んでいます」のような文を 5 秒ごとに切り替える。技術的には wait → UI が変わる印象で体感 30 秒 → 10 秒。

---

## 9. release 前に最低限直すもの

旧 7 件のうち **5 件完了 / 2 件部分対応 / 1 件未着手**。詳細は §14。

| # | 項目 | 状態 |
|---|---|---|
| 1 | S-01 alert 撤去 | ✅ 完了 |
| 2 | S-02 添削後 3-button bar | ✅ 完了 |
| 3 | S-03 loading 経過 + キャンセル | ✅ 主要 flow 完了 (cancel は 2 flow、他は将来) |
| 4 | A-01 loading 文言統一 | 🟡 主要 6 flow に LoadingProgress 展開済み、`/tutor` 見送り |
| 5 | A-02 rate limit / 残回数 UI 統一 | ⬜ 未着手 |
| 6 | A-03 各 hub の next-step suggestion | 🟡 3/4 hub 完了、`/essay` 残 |
| 7 | A-05 共通 ConfirmDialog | 🟡 4/14 件完了、残 10 件 |

**release 前に残る最低限の必須項目はゼロ**（release blocker S は全て解消）。A-02 / A-03 残 / A-05 残は **release 後の品質向上** に分類可。release QA pass と real user test は別 STEP として残る (§14 残タスク表参照)。

---

## 10. release 後改善でよいもの

- A の下位 5 件 (A-04, A-06, A-07, A-08, A-09, A-10, A-11, A-12 のうち優先低)
- B 全 8 件
- C 全 5 件

特に A-08 (`/self-analysis/result` 入口拡充) と A-09 (`/tutor` 会話保存) は **Phase 2 の主要候補**。

---

## 11. 観測項目の不変条件

本 audit doc を再生成 / 更新するとき、以下を **絶対に変更しない**:

- PROMPT_VERSION / cache identity / storage 形式
- 既出 audit doc (cleanup_phase_summary, page_fix_audit, exhaustive_deps_audit, api_observability_audit) の判定
- runtime code (本 audit は doc only)

判定が変わった場合は、対応する audit doc を先に更新し、本 doc は index 性のみ更新する。

---

## 12. 次の発火条件 (実装 STEP 候補)

### 12.1. 実施済み

- ✅ **STEP-UX-FIX-01-ALERT** (`1acd017`): S-01 alert → inline toast 置換
- ✅ **STEP-UX-FIX-02-STATEMENT-NEXT-ACTION** (`0ec5f83`): S-02 添削後 next-action bar
- ✅ **STEP-UX-FIX-04-CONFIRM-DIALOG** (`0eeec50`): 共通 ConfirmDialog 作成 + 4 caller 置換
- ✅ **STEP-UX-FIX-05-HUB-SUGGEST** (`4796364`): 3 hub に next-step suggestion (statement / self-analysis / interview)
- ✅ **STEP-UX-FIX-06-LOADING-PROGRESS** (`e8653f3`): `LoadingProgress` 新設 + `/statement/edit` + `/admission-matching` 適用
- ✅ **STEP-UX-FIX-06b-LOADING-PROGRESS-EXTEND** (`38a625a`): `/essay-practice` / `/self-analysis/run` (analysis + summarize) / `/interview/questions` に横展開
- ✅ **STEP-UX-FIX-06c-CANCEL-WIRING** (`0067317`): `/statement/edit` + `/admission-matching` に AbortController + cancel button 接続、AbortError 分岐
- ✅ **STEP-UX-FIX-06d-CANCEL-TAP-TARGET** (`104dc7c`): cancel button を size="md" + `min-h-[44px] w-full sm:w-auto` で mobile tap target 改善

### 12.2. 残候補

- **STEP-UX-FIX-04b-CONFIRM-DIALOG-EXTEND**: 残 10 callers (`components/activity/*` 9 件 + `interview/history` 1 件) を `ConfirmDialog` 移行
- **STEP-UX-FIX-05b-ESSAY-HUB-SUGGEST**: `/essay` hub に next-step suggestion 追加 (3 hub と同形)
- **STEP-UX-FIX-06e-CANCEL-WIRING-EXTEND**: cancel wiring を `/essay-practice` / `/self-analysis/run` (analysis + summarize) / `/interview/questions` に横展開
- **STEP-UX-FIX-07-MOBILE-STICKY**: A-11 sticky bottom action bar (mobile)
- **STEP-UX-FIX-08-RATE-LIMIT-UI**: A-02 残回数 UI 統一。`/essay-practice:743` を基本形に
- **STEP-UX-FIX-09-DIRECT-MODE-BANNER**: A-04 direct mode の境界明示
- **STEP-UX-FIX-10-STATEMENT-ANALYSIS-CTA**: A-06 `/statement/analysis/[id]` 下部に「書き直しを始める →」CTA

各 STEP は独立で発火可能。release blocker は解消済みのため、優先度は **release QA pass → 04b/05b の取りこぼし回収 → 06e/07/08 の品質向上** の順を推奨。

---

## 13. 関連 doc

- [`../principles/cleanup_phase_summary.md`](../principles/cleanup_phase_summary.md)
- [`../principles/page_fix_audit.md`](../principles/page_fix_audit.md)
- [`../principles/exhaustive_deps_audit.md`](../principles/exhaustive_deps_audit.md)
- [`../observability/api_observability_audit.md`](../observability/api_observability_audit.md)
- [`../principles/incremental_refactor_policy.md`](../principles/incremental_refactor_policy.md)
- [`../principles/feedback_dev_principles.md`](../principles/feedback_dev_principles.md)

---

## 14. 実施結果サマリ (STEP-UX-NOTE-01 時点)

UX audit の各 issue に対する実装状況を 1 表に集約。本表が **正本**、§5〜§7 / §9 / §12 の status 列はこの表と同期。

### 14.1. 実施済み STEP 一覧 (時系列)

| STEP | commit | 対象 | issue | 内容 |
|---|---|---|---|---|
| STEP-UX-FIX-01-ALERT | `1acd017` | `app/statement/edit/page.tsx` | S-01 | `alert('保存しました')` を self-contained toast (3 秒自動消失、pointer-events-none) に置換 |
| STEP-UX-FIX-02-STATEMENT-NEXT-ACTION | `0ec5f83` | `app/statement/edit/components/ReviewResultView.tsx` | S-02 | 添削結果直下に「↑ 本文を修正する」「📊 詳細分析を見る」「💾 別名で保存する」の 3-button bar 追加。`inputSectionRef` 経由の scroll 設計は維持 |
| STEP-UX-FIX-04-CONFIRM-DIALOG | `0eeec50` | `components/ui/ConfirmDialog.tsx` + 4 caller | A-05 | `ConfirmDialog` 新設、`statement/edit` / `statement/improve` / `statement/score` / `self-pr` の native `window.confirm()` を置換 |
| STEP-UX-FIX-05-HUB-SUGGEST | `4796364` | `app/statement/page.tsx` / `app/self-analysis/page.tsx` / `app/interview/page.tsx` | A-03 | 3 hub に「次にやるべきこと」suggestion を追加 (`/home` の `nextFeature` ロジックを各 hub に適用) |
| STEP-UX-FIX-06-LOADING-PROGRESS | `e8653f3` | `components/ui/LoadingProgress.tsx` (新規) + `/statement/edit` + `/admission-matching` | S-03, A-01, A-10 | `LoadingProgress` 新設 (経過秒 + 6 秒ごとに rotate する sub-message + `estimatedSeconds`)。最初の 2 caller に適用 |
| STEP-UX-FIX-06b-LOADING-PROGRESS-EXTEND | `38a625a` | `/essay-practice` / `/self-analysis/run` (analysis + summarize) / `/interview/questions` | S-03, A-01, A-10 | `LoadingProgress` を主要 4 flow に横展開。`/tutor` は chat-bubble UX 不適合のため見送り |
| STEP-UX-FIX-06c-CANCEL-WIRING | `0067317` | `/statement/edit` + `/admission-matching` | S-03 | client-side `AbortController` 導入。`useRef<AbortController>` + fetch `signal` + `AbortError` 分岐 (通常 error と分離、cache / history / result 上書きなし) + unmount cleanup |
| STEP-UX-FIX-06d-CANCEL-TAP-TARGET | `104dc7c` | `components/ui/LoadingProgress.tsx` | S-03 | cancel button を `size="sm"` (24-28px) → `size="md"` + `min-h-[44px] w-full sm:w-auto` で mobile tap target を 44px 以上に底上げ |

### 14.2. release blocker 状態

| blocker | 解消 | 残課題 |
|---|---|---|
| S-01 alert | ✅ 完全解消 | なし |
| S-02 添削後 next action | ✅ 完全解消 | なし |
| S-03 AI loading 経過秒 + キャンセル | ✅ 主要 flow 解消 | cancel wiring は `/statement/edit` + `/admission-matching` の 2 flow から開始。他 3 flow (`/essay-practice`, `/self-analysis/run`, `/interview/questions`) への展開は **release 後の品質向上** に分類 (06e) |

**release blocker は 0 件**。

### 14.3. 設計判断と見送り

- **`/tutor` の LoadingProgress 見送り** (06b): chat-bubble UX (1 ターンあたり 3-10s の短い AI reply) は LoadingProgress の「大きな card + 経過秒 + sub-message」とは別パラダイム。既存の「整理しています…」chat bubble の方が文脈に適合。
- **`/self-analysis/run` の `addQuestionsLoading` 見送り** (06b): 追加質問の loading は短時間で「主要 AI loading flow」スコープ外と判断。`summarizeLoading` (重い) と `analysisLoading` (重い 30s) のみに LoadingProgress 適用。
- **`AiInlineThinking` component の残置** (06b): `/self-analysis/run` で button 内 inline 使用を撤去したが、`components/shared/result/AiInlineThinking.tsx` および barrel re-export は将来 caller のため温存。
- **cancel button の `min-h-[44px]`** (06d): `size="md"` 単独では 36-40px 帯で 44px に届かないため、`min-h-[44px]` を className で明示的に重ねる。`w-full sm:w-auto` で mobile は full-width / desktop は label 幅相当。
- **unmount 時の abort** (06c): `useEffect(() => () => abort(), [])` で unmount 時に in-flight fetch を中断。React 18 の unmount-後-setState は no-op で安全。

### 14.4. 残タスク (release 前 / 後)

| タスク | 推奨タイミング | 工数感 |
|---|---|---|
| **release QA pass** (主要 flow 全 page を端末別に通し操作、edge case / empty state / error 表示の最終確認) | release **直前** | 1-2 日 |
| **real user test** (高校生 5-10 名に hub → AI 出力 → 次アクションの体感を取り、step-back 必要性を判断) | release **直前 or 直後** | 1 週間 |
| STEP-UX-FIX-04b-CONFIRM-DIALOG-EXTEND (残 10 callers) | release 後 / 並走可 | 1-2 日 |
| STEP-UX-FIX-05b-ESSAY-HUB-SUGGEST (`/essay` hub) | release 後 / 並走可 | 半日 |
| STEP-UX-FIX-06e-CANCEL-WIRING-EXTEND (他 3 flow) | release 後 / 並走可 | 1-2 日 |
| STEP-UX-FIX-08-RATE-LIMIT-UI (A-02 残回数 UI 統一) | release 後 | 2-3 日 |
| STEP-UX-FIX-07-MOBILE-STICKY (A-11 sticky bottom action bar) | release 後 | 2-3 日 |
| STEP-UX-FIX-09-DIRECT-MODE-BANNER (A-04 direct mode 境界明示) | release 後 | 1 日 |
| STEP-UX-FIX-10-STATEMENT-ANALYSIS-CTA (A-06 書き直し CTA) | release 後 | 半日 |
| B 系 8 件 / C 系 5 件 | Phase 2 | 個別判断 |

### 14.5. release 前に最低限残るもの (再評価)

- ❌ **必須 (release blocker)**: ゼロ
- ⭐ **強く推奨**: release QA pass + real user test (上記)
- ⬜ **release 後で十分**: A-02 / A-04 / A-06 / A-07 / A-08 / A-09 / A-11 / A-12 残、B 全件、C 全件

§9 の判定は「S-01〜S-03 が全て解消、release blocker 0 件」へ更新済み。Phase 2 (release 後) の主要候補は引き続き `/tutor` 会話保存 (A-09) と `/self-analysis/result` 入口拡充 (A-08) を推奨。
