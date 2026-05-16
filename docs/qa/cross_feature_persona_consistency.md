# Cross-Feature 人格一貫性 QA 設計

PASSAI 全体で「同じユーザーが同じ人物として扱われているか」を検証する QA 基盤の設計書。
本ドキュメントは **QA 設計のみ**（実装・prompt・API route は変更しない）。

関連: [student_profile_contract.md](../principles/student_profile_contract.md), [architecture_rules.md](../principles/architecture_rules.md), [ai_score_contract.md](../principles/ai_score_contract.md), [lib/contextBuilders/README.md](../../lib/contextBuilders/README.md)

---

## 1. なぜ必要か

PASSAI の価値は **「AI が文章を書く」ことではなく、「AI が一貫した人物理解を維持する」こと**にある。

活動整理 → 自己分析 → self-pr → statement → interview → 将来の counselor AI が、すべて同じ `StudentProfile` を共有する **人格一貫型プロダクト**として動いている。

そのため従来の「API が 200 を返すか」「JSON contract が守られているか」型の単体 QA だけでは不足する。
**feature 横断で人格が崩壊していないか**を確認する別レイヤの QA が要る。

直接の動機: 2026-05 の self-pr stale profile 不具合（深掘り修正後の summary が self-pr に伝わらず、別人格化したアウトプットが生成された）。型・API は全て正常だったが、**人物像としては破綻していた**。

---

## 2. QA の目的

下記 6 軸の cross-feature 一貫性を検証する:

| 軸 | 検証する問い |
|---|---|
| strengths consistency | self-pr / statement / interview / matching が同じ強みを核として扱っているか |
| motivation consistency | 志望動機 / 将来とのつながりが feature 間で矛盾していないか |
| problem awareness consistency | 弱み・課題認識・解決姿勢が feature 間で同じ人物のものとして読めるか |
| future goal consistency | 将来像（futureConnections）が feature ごとに別物になっていないか |
| tone consistency | 話し方の温度感（地に足／背伸び／淡々／情熱的）が feature ごとに別人化していないか |
| activity interpretation consistency | 同じ活動の意味づけが feature 間で変質していないか |

---

## 3. 人格一貫性の定義

**人格一貫性 ≠ 完全同一文面**。表現揺れは許容し、人格崩壊だけを止める。

### 3.1 OK（許容される表現揺れ）

- self-pr で「主体性」、interview で「自分から動く力」と言い換える
- statement で「探究心」、self-pr で「最後まで突き詰める姿勢」と同じ強みを別フレーズで語る
- feature ごとに語る順序・粒度が違う（self-pr は 1 強み深掘り、matching は 5 強み列挙）

### 3.2 NG（人格崩壊）

- self-pr の主強み = 「主体性」、statement の主強み = 「協調性」、interview の主強み = 「論理的思考」と **核となる強みが入れ替わる**
- self-pr では「人前で話すのが得意」、interview の自己紹介では「人前で話すのが苦手」と **同じ属性が逆転する**
- 同じ活動が self-pr では「部活動」、statement では「探究学習」、matching では「ボランティア」と **カテゴリが別物になる**
- 将来像が statement では「医師志望」、interview では「研究者志望」、matching では「教員志望」と **進路の核が分裂する**

### 3.3 表現揺れ vs 人格崩壊の境界

|  | 表現揺れ（OK） | 人格崩壊（NG） |
|---|---|---|
| 強み | 別フレーズで同義 | 核となる強みが別属性 |
| 活動 | 説明の粒度が違う | カテゴリ／主役が別物 |
| 将来像 | 抽象度が違う | 進路の核が分裂 |
| 弱み | 言及する有無 | 強みと逆転 |
| 文体 | 「です・ます」「だ・である」混在 | 性格が別人化 |

---

## 4. 現在の canonical flow

人格データの流れと **drift が起きうる点**:

```
ActivityData                    ← raw 活動入力
   │
   ▼
WallHittingResult               ← /api/analysis 出力
   │      ⚠ drift point A: questions / answers の working memory を下流に直流すと別人格化
   ▼
SummaryResult                   ← /api/summarize 出力
   │      ⚠ drift point B: SummaryResult を StudentProfile に patch し忘れる（self-pr stale 事故）
   ▼
StudentProfile                  ← canonical 人格スナップショット
   │      ⚠ drift point C: feature が StudentProfile を読まず WallHittingResult / cache を直読み
   ▼
Context Builders                ← lib/contextBuilders/{feature}*
   │      ⚠ drift point D: feature builder が独自フィールドを足す／省きすぎる
   ▼
Feature Prompts                 ← lib/prompts/{feature}Prompt.ts
   │      ⚠ drift point E: prompt 内で「ない情報を補完しろ」と AI に指示する
   ▼
Outputs                         ← API route の出力
          ⚠ drift point F: AI 出力で「強みを盛る」「説得力のために別の強みを足す」現象
```

drift point の整理:

| Drift point | レイヤ | 例 | 予防 |
|---|---|---|---|
| A | raw 直流 | feature が `loadWallHittingResult()` を直読み | `getStudentProfileForFeature` を経由 |
| B | canonical 未更新 | 深掘り修正後の summary が profile に未反映 | self-analysis 側で patch（[student_profile_contract.md §5](../principles/student_profile_contract.md)） |
| C | canonical bypass | feature 専用 cache を持つ | StudentProfile 経由を強制 |
| D | builder 暴走 | builder で AI 呼び / 独自派生 | builder = 純粋関数 |
| E | prompt 補完 | 「足りなければ推測しろ」prompt | prompt 補完禁止 |
| F | AI 暴走 | 出力で強みが盛られる | cross-feature 比較 QA で検出 |

---

## 5. QA 観点（feature 別）

### 5.1 self-pr

- **strengths** — StudentProfile.strengths 上位が PR の主軸と一致しているか
- **signatureEpisodes** — 具体例が profile と矛盾していないか（部活活動 vs 学外活動が逆転していないか）
- **tone** — interview / statement と整合する語り口か（PR だけ過度に背伸びしていないか）
- **appealPoints** — 最新 SummaryResult.appealPoints と一致するか（cache 経路含む）

### 5.2 statement

- **motivation alignment** — 志望動機が futureConnections と整合
- **university fit** — 受験大学・学部・受験方式と矛盾しない記述
- **problem awareness** — 弱み記述があれば profile.weaknesses と整合
- **論理一貫性** — 強み → 活動 → 志望理由 → 将来像 の連鎖が同一人物として読めるか

### 5.3 interview

- **spoken explanation consistency** — 自己紹介が self-pr / statement と同じ核を持つか
- **weakness handling** — 弱み回答が self-pr の隠ぺい姿勢と矛盾していないか
- **growth narrative** — 過去 → 現在 → 将来の語りが statement の motivation と整合
- **expected question focus** — 想定質問が profile の signatureEpisodes と連動

### 5.4 matching

- **admission type interpretation** — 一般／総合型／推薦の傾向解釈が profile と整合
- **evaluation basis consistency** — 推薦根拠が strengths / futureConnections と整合
- **scoring factors** — マッチングスコアの根拠が他 feature の語りと矛盾しない

### 5.5 共通観点

- StudentProfile.sourceHash が同一の状態で全 feature を実行した時、core identity が一致するか
- StudentProfile を更新した時、全 feature が同じ更新を反映しているか（stale 検出）

---

## 6. 実機 QA シナリオ

最低限走らせるシナリオ。各シナリオで **全 feature を順に通す** ことが本 QA の本体。

| # | シナリオ | 確認軸 |
|---|---|---|
| S1 | **新規ユーザー（活動 3 件・標準）** | 6 軸すべての baseline |
| S2 | **深掘り修正あり**（self-analysis で再 summary） | drift point B — self-pr / interview / matching が最新 summary を反映 |
| S3 | **cache hit 経路**（同 input で summarize 再実行） | StudentProfile patch が cache hit でも走る |
| S4 | **ブラウザリロード後** | localStorage 復元が canonical を壊さない |
| S5 | **localStorage 全消去 → 再生成** | 初期化フローで人格が再構築される |
| S6 | **長文活動**（深掘り回答 2000 字級） | freeMemo / 切り詰めで核情報が失われない |
| S7 | **活動少なめユーザー**（活動 1 件・回答短文） | profile が空配列でも feature が破綻しない |
| S8 | **理系志望** | 探究／研究系の強みが各 feature で同じ意味で扱われる |
| S9 | **文系志望** | 言語／対話系の強みが各 feature で同じ意味で扱われる |
| S10 | **AO / 総合型** | matching / statement / interview で同じ志望方式として扱われる |
| S11 | **学校推薦** | 推薦適性が strengths と整合的に語られる |
| S12 | **複数大学混在**（matching 用） | 複数大学に対する適性語りが同じ核から派生 |

各シナリオで `StudentProfile.sourceHash` を記録し、feature ごとの core identity を抜き出して **3〜5 軸の比較表** を作る（§8 判定基準で評価）。

---

## 7. Persona Drift の典型例

| Drift 種別 | 例 |
|---|---|
| **strengths drift** | self-pr「主体性」／ statement「協調性」／ interview「論理性」と主強みが入れ替わる |
| **tone drift** | self-pr で熱意ある語り、interview で淡々と機械的、statement で背伸びした硬さ |
| **motivation drift** | statement で「研究したい」、interview で「現場で働きたい」と動機の核が変わる |
| **university fit drift** | matching で A 大学向きと判定、statement で別大学のポリシーに寄せている |
| **over-optimization drift** | 各 feature が「その feature で受けが良い人物像」に最適化、合計すると複数人格 |
| **genericization** | feature 出力がテンプレ化、profile の固有性が消えて誰でも当てはまる文章になる |
| **episode drift** | 同じ活動が feature ごとに別カテゴリ（部活／探究／ボランティア）として語られる |
| **weakness inversion** | self-pr で「強み」だった属性が interview で「弱み」になる |
| **future split** | 将来像が feature ごとに別進路（医師／研究者／教員）になる |

---

## 8. 判定基準

drift を 3 段階で分類。

| 段階 | 定義 | 例 | 対応 |
|---|---|---|---|
| **minor** | 表現揺れの範囲。core identity は一致 | 同じ強みを別フレーズで言い換え／粒度の違い | 許容（記録のみ） |
| **moderate** | 表現以上・核未満。語りの順序や強調が feature 間で食い違う | self-pr の主強みが statement では補助に下がる | 改善候補。次の prompt 改修 STEP で対応 |
| **severe** | core identity conflict。同一人物として読めない | 主強みが別属性へ／活動カテゴリが入れ替わる／将来像が分裂 | release blocker。原因（drift point A〜F）を特定して PR を分離 |

判定の原則:

- **feature variation は許容する**（feature 最適化を全否定しない）
- **core identity conflict は NG**（人物が別人になる drift だけを止める）
- 「完全同一文面」は要求しない（§3 §11 と整合）
- 判定は **3〜5 軸の比較表** をもとに行う（主強み／主活動／将来像／弱み／tone）

---

## 9. 将来的な自動化方針（未実装）

現段階は手動 QA のみ。将来下記に発展しうる設計余地を残す:

| 段階 | 内容 | 依存 |
|---|---|---|
| F1. snapshot QA | feature 出力のスナップショットを保存し PR 前後で diff | `scripts/step15-qa.ts` 拡張余地 |
| F2. prompt regression | PROMPT_VERSION bump 時に core identity 軸の自動比較 | [ai_score_contract.md](../principles/ai_score_contract.md) の PROMPT_VERSION 運用と接続 |
| F3. profile consistency diff | StudentProfile patch 前後で各 feature 出力の core identity を抽出して diff | Context Builder Layer の安定後 |
| F4. cross-feature identity scorer | 軽量 AI 評価器で core identity の一致度をスコア化 | 評価 prompt 設計が別 STEP |

**現時点では実装しない**。手動 QA で§3 §8 を満たすことが先。

---

## 10. StudentProfile contract との関係

[student_profile_contract.md](../principles/student_profile_contract.md) は本 QA の **規範文書**。

- canonical profile が人格同期の中心
- 全 feature は StudentProfile を読む（feature 専用人格を持たない）
- partial patch / null-empty 回避 / stale 流出禁止が守られていることが、本 QA が成立する前提
- 本 QA で **moderate / severe な drift** を検出した場合、まず student_profile_contract の遵守状況を疑う（drift point A〜C）

---

## 11. Context Builder Layer との関係

[lib/contextBuilders/README.md](../../lib/contextBuilders/README.md) で導入された層は本 QA の **drift 抑制装置** として働く。

- feature ごとの adhoc context 組み立てを禁じ、Context Builder に集約することで **prompt layer drift を減らす**
- 各 builder が同じ canonical（StudentProfile）を起点にすることで、**feature ごとの人格解釈差分を縮める**
- ただし Context Builder が独自に派生フィールドを作ると drift point D が発生する。builder の責務は「trim と重み付け」にとどめ、新フィールド派生は禁止
- 本 QA で drift point D が頻発するなら、当該 builder の責務逸脱を疑う

---

## 12. Anti-pattern

本 QA で検出すべき / 構造的に防ぐべきパターン:

- **feature ごとの人格生成** — feature 専用 storage に「縮めた人格」を持つ
- **stale profile 利用** — canonical 更新が伝わらないまま下流が古い人物像で動く
- **prompt 内 adhoc persona 補完** — 「足りない情報は推測してください」型の prompt
- **generic strengths injection** — profile が薄い時に「協調性」「主体性」を雛形として注入
- **feature 最適化しすぎて人格崩壊** — 各 feature で「受けが良い人物像」に寄せた結果、合計人格が崩れる
- **raw WallHittingResult 直読み乱立** — `getStudentProfileForFeature` を経由しない
- **prompt 内で profile を再要約** — 既に整形済みの profile を AI に再要約させて意味が変わる
- **cache hit 経路の sync 漏れ** — cache hit で canonical patch を省く（self-pr stale 事故の根本原因）

---

## 締めくくり

**PASSAI の QA は feature correctness だけでなく、cross-feature human consistency を扱う**。
個々の API が正しく動くことは前提でしかなく、それらが **同じ人物について語っているか** を検証して初めて、PASSAI の価値（一貫した人物理解）が保証される。
