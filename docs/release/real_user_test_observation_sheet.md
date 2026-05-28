# Real User Test — Observation Sheet

作成日: 2026-05-28
対象 branch: `feature/supabase-migration`
直前 commit: `fe81583 Add smoke test results template`

## 1. 目的

PASSAI を **高校生ユーザー** に実際に触ってもらい、開発者視点では見えない UX friction を観察・記録する。

具体的な観察観点:

| 観点 | 何を見るか |
|---|---|
| 「次に何をすればいいか」分かるか | hub → flow → 結果 → 次 action が自発的に追えるか |
| LoadingProgress が安心感を与えるか | 経過秒・sub-message を見て待てるか / 「壊れた」と思わないか |
| rewrite / improve flow が理解できるか | analysis → rewrite → compare の流れを言語化できるか |
| Home suggestion が機能するか | nextFeature card を見て自然に CTA を選べるか |
| AI 出力後に止まらないか | 出力を読み終えた後、自発的に次に進めるか |
| save / autosave を信頼できるか | 「保存されたか不安」確認行動が出るか / toast / 履歴で安心するか |

本 doc は **observation sheet テンプレート**。実施時は `real_user_test_results_NN.md` (NN = participant 連番) としてコピーして記録する。

---

## 2. テスト実施前提

### 2.1. 倫理 / 同意

- 高校生に依頼する場合は **保護者の同意** を取得する
- 「画面を録画 / 音声を記録 / メモを取る」ことを事前に明示し同意を得る
- 「アカウント / 入力データはテスト終了後に削除する / 個人特定可能な内容は記録しない」ことを伝える
- 途中で **いつでも中止できる** ことを伝え、終了時に必ず確認する
- 謝礼を出す場合は事前に金額・形式を明示する

### 2.2. 環境

| 項目 | 設定 |
|---|---|
| URL | 本番 deploy URL (smoke test で GO 判定済の commit) |
| device | 第一選択: 参加者本人の **mobile** (iOS Safari / Android Chrome)。可能なら PC も併用 |
| browser | 参加者の普段使い (DevTools は基本開かない、観察者側のみ別画面で開く) |
| ネット環境 | 通常の wifi or モバイル回線 |
| アカウント | テスト専用の新規アカウント (localStorage 空状態で開始) |
| 観察者 | 観察 + 記録に専念。可能なら 2 名体制 (進行担当 / 観察担当を分離) |
| 録画 | 画面 + 音声 (参加者の独り言を拾うため)。後で見返せるよう保存 |
| 所要時間 | 60-90 分 (前後説明 + flow 体験 + interview) |

### 2.3. やらないこと (analytics / tracking 禁止)

- runtime code への tracking script 追加は **しない** (本 STEP の禁止事項)
- 行動 log は **観察者の手書きメモ + 録画** で取る
- 後日 production に analytics を入れる場合は別 STEP (release 後の monitoring 系) として扱う

---

## 3. 推奨観察 flow と参加者割当

1 人にすべてやらせない。**flow ごとに 2-3 名** を目安に分担。

| 参加者プロファイル | 担当 flow | 所要 |
|---|---|---|
| A 完全初見 (PASSAI 未経験 / 高 2 春想定) | 初回導線 → 自己分析 → 自己 PR | 45 分 |
| B 初見 + 志望理由書を書いた経験あり (高 3 夏想定) | 初回導線 → 志望理由書添削 → score → rewrite | 60 分 |
| C 初見 + 志望校が決まっている (高 3 秋想定) | 初回導線 → matching → tutor | 45 分 |
| D 受験経験者 (浪人 / 大学 1 年) | 全 flow 任意操作 (free exploration) | 60-90 分 |

最低 **4 名 (A/B/C/D 各 1)**。理想は **6-8 名** (各プロファイル 2 名)。1 人で同じ flow を 2 度回すより、別人が同じ flow を 1 度ずつ回す方が friction が浮き彫りになる。

---

## 4. Observation Sheet (per participant)

実施時はこの section を participant ごとにコピーして記入する。

### 4.0. 基本情報

| 項目 | 値 |
|---|---|
| participant ID | P-XX |
| profile | A / B / C / D (§3 参照) |
| 学年 / 受験区分 | (...) |
| 実施日時 | YYYY-MM-DD HH:MM |
| 所要時間 (全体) | XX 分 |
| device | mobile / PC (機種、OS) |
| browser | (...) |
| 観察者 | (name) |
| 録画ファイル | (path or share URL) |
| 同意取得 | ☐ 本人 ☐ 保護者 ☐ 録画 ☐ 中止権 |

### 4.1. flow 別観察 (担当 flow のみ記入)

各 flow を以下フォーマットで記録:

```markdown
#### flow: (flow 名、例: 「初回導線 → 自己分析」)

| 項目 | 値 |
|---|---|
| 開始時刻 | HH:MM |
| 完了時刻 | HH:MM (未完走なら離脱時刻) |
| 完走 | ☐ 完走 / ☐ 部分完走 / ☐ 離脱 (理由: ...) |
| 詰まった箇所 (page + 操作) | (1) (...) / (2) (...) |
| 質問された回数 | N 回 (内容: ...) |
| 説明が必要だった箇所 | (...) |
| 離脱しそうだった箇所 | (...) |
| Loading 待機への反応 | 静観 / 連打 / 不安発言 / 別ページへ離脱 |
| AI 出力への反応 | 読み込む / 軽く眺める / 読まず閉じる / 不満発言 / 喜び発言 |
| 次 action を自発的に選べたか | ☐ Yes / ☐ ヒントで選べた / ☐ ヒントでも選べず |
| 印象に残った発言 (verbatim) | 「(...)」「(...)」 |
| 観察者メモ | (...) |
```

担当 flow の数だけ繰り返す。

### 4.2. participant 全体メモ

| 項目 | 値 |
|---|---|
| 全 flow 通しての完走率 | 完走 / 部分 / 離脱 |
| もっとも詰まった page (TOP 3) | (1) (2) (3) |
| もっとも好印象だった機能 (TOP 3) | (1) (2) (3) |
| 観察者の総合所感 (3-5 行) | (...) |

---

## 5. 観察すべき signal リスト

観察者は以下の **行動 / 表情 / 発話** を chk する。録画見返し時にも同じ signal を chk する。

### 5.1. 行動 signal

| signal | 意味 / 推測される問題 |
|---|---|
| 無言停止 (5 秒以上) | 何をすればよいか分からない / page 構造が読めない |
| スクロール迷子 (上下に何度もスクロール) | CTA の位置が分からない / 情報量過多 |
| button / link を探す (マウス・指が彷徨う) | CTA visibility 不足 |
| Loading 中の連打 (button / 画面 tap) | 「壊れた」と感じている / 進行表示の不足 |
| 戻る操作 (browser back / 「← 戻る」link) | 前 page で得た情報を再確認したい / 現 page が機能しない |
| reload を試みる | error と誤認 / 待ちきれない |
| history / 過去結果を探す | 「あの時の AI 出力をもう一度見たい」のニーズ |
| AI 出力を読まず閉じる | 文章長すぎ / 関心薄 / 次 CTA が目立たない |
| compare / rewrite の意味理解失敗 (誤遷移) | 機能名の不一致 / 説明不足 |
| 「保存された？」確認行動 (戻ってもう一度開く 等) | save feedback 不足 / autosave が見えない |
| native scroll が引っかかる (modal / overlay 上で背景がスクロールしてしまう) | overlay 設計 issue |
| keyboard が textarea を隠す | mobile keyboard 対応の不足 |

### 5.2. 発話 signal

| 発話 | 推測される問題 |
|---|---|
| 「これ何？」 | 機能名 / 概念が伝わっていない |
| 「どこ押せばいい？」 | CTA visibility 不足 |
| 「壊れた？」「動いてる？」 | Loading 進行表示不足 |
| 「もう一度やる？」「最初から？」 | 完了感がない / next action 不明 |
| 「これで合ってる？」 | success feedback 不足 |
| 「長い…」「読むの面倒」 | 出力量過多 / 段組み不足 |
| 「ちゃんと保存された？」 | save feedback 不足 |
| 「他にはないの？」 | alternative CTA / cross-link 不足 |
| 「戻れる？」 | 戻り導線が見えない |

これらは **発生回数を `tally count` (正の字) で記録** することを推奨。後で「観察 N 回中、reload 行動が M 回」という形で集計できる。

---

## 6. テスト実施ルール (moderator 用)

### 6.1. やる

- 導入で目的・録画・中止権を **必ず説明**
- 「**何を考えているか口に出してもらう** (think-aloud)」を依頼
- 参加者が詰まったら **10 秒待つ**。それでも進めなければ「どこで止まっていますか？」と open question
- 観察者は **行動の事実だけ** を記録 (「○○を 3 回 tap した」)
- 完了速度ではなく **迷いの量** を見る
- AI quality だけでなく **flow continuity** を見る (出力 → 次の一歩が自然か)
- 終了後 `release 判定` への影響度を §8 基準で評価

### 6.2. やらない

- ヒントを先回りで出す (誘導してしまうと「初見の詰まり」が見えなくなる)
- 「ここを押すと…」と教える
- 機能の弁護をする (「いや本当は…」)
- 参加者の意見を否定する
- 設計意図を解説する (テスト中は black box として扱う)
- 録画なしで進める (見返しが効かなくなる)
- 1 人に全 flow を強制 (疲労 → 信頼度低下)

---

## 7. 終了後 interview (15-20 分)

flow 体験が一通り終わったら、participant に以下を口頭で聞く。録画継続 + メモ。

### 7.1. 体験そのもの

1. 一番 **分かりにくかった** 場所はどこですか？ なぜ？
2. 一番 **便利だった** 機能は何ですか？ なぜ？
3. AI の **待ち時間** はどう感じましたか？ (15 秒 / 30 秒 / 60 秒 を比較できれば聞く)
4. AI が出した **結果** は、自分にとって役に立つと感じましたか？ どこが？
5. 「次にこれをやればいいんだな」と **迷わず進めた** flow はありましたか？ どこ？
6. 逆に「次に何をすればいいか分からない」と感じた flow はありましたか？ どこ？

### 7.2. 継続意思

7. これを **明日もう一度開いて続き** をやりたいですか？ なぜ?
8. 受験勉強で **本当に使いたい** と思いますか？ なぜ?
9. これが **有料** だったら払いますか？ いくらまで?
10. 友達や先生に **勧めます** か? どう紹介する?

### 7.3. 改善要望 (open question)

11. 「ここを直したらもっと良くなる」と思う点を 3 つ挙げてください。
12. 「これがあったらもっと使う」と思う機能を 3 つ挙げてください。
13. 自由意見 (時間が許す限り)

回答は **要約せず verbatim** で記録する (後で signal 分析できなくなるため)。

---

## 8. release 判定への使い方

### 8.1. 集計方法

参加者 N 名 (推奨 4-8 名) の observation sheet を統合し、以下を集計:

| 指標 | 集計方法 |
|---|---|
| flow 完走率 | 各 flow ごとに `完走 / 全担当者` を % で |
| 詰まった箇所 ranking | 全 participant の「詰まった箇所」を集約、登場回数で sort |
| signal 発生回数 (§5) | participant × signal の matrix |
| interview Q1-Q13 の傾向 | 答えを軽くタグ化して頻出語抽出 (手動でよい) |
| 継続意思 (Q7-Q10) | Yes / No / 条件付き の三値で集計 |

### 8.2. 重大 issue の基準 (release 判定)

| 観察結果 | severity | release 影響 |
|---|---|---|
| **2 名以上** が同じ page で **離脱** | **S** | release blocker。直すまで release stop |
| **半数以上** が「次に何をすればいいか分からない」を訴える | **S** | release blocker (UX core が崩れている証拠) |
| **2 名以上** が AI 待機中に **reload / 連打** | **A** | release 前修正推奨 (LoadingProgress 強化 or cancel 説明追加) |
| **2 名以上** が compare / rewrite の意味を **誤解** | **A** | release notes + 後続 STEP で説明追加 |
| **2 名以上** が save feedback 不足を発言 | **A** | release 前修正推奨 |
| **1 名** だけが詰まった (再現性低) | **B** | backlog 化、再現観測待ち |
| 継続意思 (Q7-Q10) が **大半 No** | **S** | UX 根本見直し (release 延期検討) |
| 継続意思が **大半 Yes** だが個別不満多数 | **A 集合** | release 後の品質向上 phase で計画的に潰す |

### 8.3. release decision flow

```
real user test 完了
  ↓
S 級発見?
  ├─ Yes → release stop。修正 STEP 作成 → 修正後 同 profile で再テスト
  └─ No  → A 級発見?
            ├─ Yes → release notes + 後続 STEP 作成 → GO WITH NOTES
            └─ No  → smoke test §6 完了条件 と合わせて GO
```

smoke test (`release_smoke_test_01.md`) と real user test は **両方 pass** で release 推奨。片方だけでは判断材料として不足。

### 8.4. release 後の monitoring との接続

real user test で見つかった signal は、release 後の monitoring (Anthropic usage / error rate / 1 day retention) でも追えるよう、issue 化のメタ情報に **「real user test #N で観察された」** と記録する。本番ログで再発確認できれば優先度を上げて修正。

---

## 9. 観測項目の不変条件

本 sheet を使った記録 doc を更新するときは:

- 結果記入は **実施時 1 回限り** を原則とする (追記は §8.4 monitoring 結果との接続のみ)
- 参加者の発話は **要約せず verbatim** で残す
- 録画ファイルは **第三者と共有しない** (個人情報保護)
- runtime code を変更しない (本 doc は記録のみ)
- analytics / tracking script を導入しない (本 STEP の禁止事項)
- 既出 doc (`release_qa_pass_01.md`, `release_smoke_test_01.md`, `release_smoke_test_results_template.md`, `../ux/ux_audit_phase1.md`) と矛盾しない

---

## 10. 関連 doc

- [`release_smoke_test_01.md`](./release_smoke_test_01.md) — 静的 + 簡易動作確認 (本 doc の前段)
- [`release_smoke_test_results_template.md`](./release_smoke_test_results_template.md) — smoke test 結果テンプレート
- [`release_qa_pass_01.md`](./release_qa_pass_01.md) — 静的 QA pass
- [`../ux/ux_audit_phase1.md`](../ux/ux_audit_phase1.md) — UX audit 正本 (§14 が実施結果サマリ)
- [`../principles/cleanup_phase_summary.md`](../principles/cleanup_phase_summary.md) — フェーズ全体 summary
- [`../principles/feedback_dev_principles.md`](../principles/feedback_dev_principles.md) — 開発方針
