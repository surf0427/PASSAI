# Deterministic Supplement Verification Plan（運用ガイド）

DET-2 / DET-3 / DET-4 で statement-review / essay-review に導入した deterministic 補助の実効果を検証するための観測手順書。
削減フェーズ（DET-5 以降）へ進む前の **品質検証ゲート**。

---

## 1. 目的

- DET-2 〜 DET-4 で AI 出力品質を毀損していないことを確認する
- "AI に新しい仕事を与えていない" を実出力で検証する
- 期待した token 削減効果が出ているかを観測する
- DET-5（候補 A' / E / C / D ほか）へ進むかの判断材料を集める

本書は **削減フェーズではなく検証フェーズ** の正本。新候補に着手する前に、既に投入した 3 STEP の妥当性を確かめる責務を持つ。

実装の単一情報源は既存ファイル（[lib/detectNgWords.ts](../../lib/detectNgWords.ts) / [lib/structureAnalysis.ts](../../lib/structureAnalysis.ts) / [lib/hash/statementReview.ts](../../lib/hash/statementReview.ts) / [lib/hash/essayReview.ts](../../lib/hash/essayReview.ts) / 各 prompt builder）が優先される。本書は **観測と判断のレイヤ** のみ扱う。

---

## 2. 観測対象

| STEP | route | 注入内容 | PROMPT_VERSION |
|---|---|---|---|
| DET-2 | `/api/statement-review` | NG word section（`detectNgWords`） | 6 → 7 |
| DET-3 | `/api/essay-review` | structure section（`analyzeStructure`） | 2 → 3 |
| DET-4 | `/api/statement-review` | structure section（`analyzeStructure`） | 7 → 8 |

statement-review は **DET-2 + DET-4 の共存状態（v8）** で観測する。essay-review は DET-3 単独（v3）。

---

## 3. 観測項目

### 3.1 定量項目（既存 log / hook から取得）

| 項目 | 取得手段 |
|---|---|
| route 別 saved tokens 推移 | `__PASSAI_VALIDATION_STATS__.getRouteEconomics()` |
| 全体 cost intuition | `__PASSAI_VALIDATION_STATS__.cost()` |
| reject / warning rate（DET 経路に影響なし） | `__PASSAI_VALIDATION_STATS__.metrics()` |
| cache hit / miss 率 | `[ai cache]` log の grep 集計 |
| AI 実消費 input / output token 平均 | `[ai usage]` log の `usage.input_tokens` / `usage.output_tokens` |
| prompt cache 割引（read tokens 比率） | `[ai usage]` の `cache_read_input_tokens / input_tokens` |
| AI 出力 parse failure 率 | `[ai usage]` の `status='parse_failed'` 件数 |
| AI 出力 truncated 率 | 同 `status='truncated'` |

### 3.2 定性項目（AI 出力の人間レビュー）

| 項目 | 何を見るか |
|---|---|
| score 5 軸分布（statement-review） | `logic` / `specificity` / `universityFit` / `futureGoal` / `originality` の中央値と range が pre-DET と乖離していないか |
| breakdown 5 軸分布（essay-review） | 論理構造 / 具体性 / 説得力 / テーマ理解 / 独自性 の同上 |
| verdict 分布（essay-review） | 4 値（合格ライン / あと一歩 / 改善必要 / 構造からやり直し）の比率が pre-DET から大きく動いていないか |
| weakness 重複率（DET-2 効果） | NG section に列挙された phrase と weaknesses が **意味的に重複**していないか — 重複が多いと DET-2 効果が出ていない |
| weakness の structure 重複率（DET-4 効果） | structure section で score=2 の要素が weaknesses に挙がっていないか — 挙がっていないほうが DET-4 効果が出ている |
| actions の具体性 | "具体性を上げる" "もっと書く" のような **抽象表現** が混入していないか — 混入は劣化サイン |
| partialExamples の質 | 実用的な書き直し例として読めるか、180-220 字制約を守れているか |
| improvement の質（essay-review） | 1 文行動指示が "〜してください" 形で具体化されているか |
| 文体 / トーン | 称賛だけの修飾、説教調、精神論が増えていないか |

---

## 4. 観測方法

### 4.1 dev session でのサンプル収集

1. dev サーバを起動（`next dev`）
2. ブラウザで statement edit / essay practice にアクセス、実本文を投稿
3. AI 応答を目視レビューしながら DevTools Console で:
   ```js
   __PASSAI_VALIDATION_STATS__.cost()
   __PASSAI_VALIDATION_STATS__.getRouteEconomics()
   __PASSAI_VALIDATION_STATS__.reset()   // session を clean に始めるとき
   ```
4. server console（dev terminal）で `[ai usage]` / `[ai cache]` の log を流し見

### 4.2 score 分布の取得

定量 log は score 値を持たない（payload 安全性から外している）。score 分布は **dev session 中の目視メモ** または **手元 spreadsheet** で記録する。

例: route × sample 番号 × 各軸 score × verdict のマトリクスを手書きで作る。CAL-1 と同じ "人間判断の作業" として扱う。

### 4.3 weakness 重複率の算出

各 sample で:

1. 入力 essay に対して `detectNgWords()` / `analyzeStructure()` を手元で実行（または route から returns される deterministic 結果を AI 出力と並べてメモ）
2. AI 出力の `weaknesses` 配列を読み、各要素が deterministic 検出結果と **意味的に重複** していないかを目視判定
3. 「重複あり」と判定した件数 / 全 weakness 数 = 重複率

重複率の **減少** が DET-2 / DET-4 の主目的。pre-DET の baseline は手元の旧 sample（v6 / v2 時代の出力履歴）と比較。

### 4.4 観測 1 セットあたりの作業時間

1 sample ≒ 2-3 分（本文投稿 + AI 待機 + 出力レビュー + メモ）。10 件で約 25-30 分。

---

## 5. サンプリング方法

| 段階 | 推奨件数 | 目的 |
|---|---|---|
| 初期傾向把握 | **route 別 10 件** | 明らかな劣化の有無を判断 |
| 安定性確認 | **route 別 20 件** | 5 軸 score の中央値が安定するか |
| 意思決定根拠 | **route 別 30 件** | DET-5 進行 / 部分 rollback / 全戻しの判断 |

### サンプリング ガイダンス

- 1 session で 5〜10 件、**複数日に分散** する（cache 温度・session bias 吸収）
- statement-review は入力本文を変えて多様性を確保（テスト用本文 5-10 種を準備）
- essay-review はテーマを変えて 2-3 ジャンル横断（社会課題 / 抽象論題 / 進路）
- exactness 不要 — [validation_cost_calibration.md §4](./validation_cost_calibration.md) の averaging philosophy と同じ「人間判断 / outlier 除外」原則を踏襲

### 観測期間の目安

- **最小**: 2 週間（dev で route 別 30 件に到達）
- **推奨**: 3-4 週間（複数日のばらつきを吸収）
- 期間中に **prompt 関連の他改修を入れない**（DET-2 / DET-3 / DET-4 の効果を分離するため）
- bump 直後の 1 週間は cache 強制 miss が含まれるため、判定は最低 2 週目以降

---

## 6. success criteria（DET-5 へ進める状態）

下記すべて満たす:

| 観測項目 | 基準 |
|---|---|
| statement-review 5 軸の中央値 | pre-DET-2 baseline から **±3 以内**（各軸独立） |
| essay-review 5 軸の中央値 | 同上、pre-DET-3 baseline から **±3 以内** |
| essay-review verdict 分布 | 4 値の比率が pre-DET から **大きくは動いていない**（特定 verdict の独占がない） |
| weakness の deterministic 重複率 | pre-DET より **下がっている**（NG section / structure section と被らない指摘が増えた） |
| actions 抽象表現混入率 | pre-DET と **同等 or 減少**（増加していない） |
| partialExamples 文字数規律 | 180-220 字制約の守られ方が pre-DET と **同等** |
| `cost().estimatedAvoidedTotalTokens` 月推計 | DET-1 予測（statement-review 24K-36K / essay-review 8K-12K）の **下限以上** |
| `[ai usage]` の input_tokens 平均 | structure / NG section が追加された分（概ね 500 chars 程度）の増加を **上回らない** |
| AI 出力 parse failure 率 | pre-DET と **同等 or 減少** |
| AI 出力 truncated 率 | pre-DET と **同等 or 減少** |
| `[ai cache]` hit rate | bump 直後の miss は許容、その後 pre-DET の水準まで戻る |

**判定**: 全項目を route 別 30 件 sample で確認 → DET-5 進行可能。

---

## 7. warning criteria（観測継続 / refinement 検討）

いずれか発生:

| 観測項目 | 基準 |
|---|---|
| score 中央値（特定 1 軸） | pre-DET から **±5 以内**だが片寄りが見える |
| weakness の deterministic 重複率 | pre-DET と **同等 or 微増**（DET-2 / DET-4 の効果が弱い） |
| actions specificity 改善 | 期待した「行動レベル指示の精緻化」が見えない |
| AI 出力 token 平均 | section 追加分を超えて増加（**+10% 以上**） |
| `cost().estimatedAvoidedTotalTokens` | DET-1 予測の **50% 未満** |
| weakness 数の減少 | 想定より少ない（AI が NG / structure を機械的に列挙し続けている疑い） |

**対応**:

- 観測期間を延ばす（30 件 → 50 件）
- SYSTEM_PROMPT 側 qualifier の文言再検討（rollback ではなく refinement の別 STEP として立てる）
- DET-5 進行は **保留**

---

## 8. failure criteria（rollback 検討）

いずれか発生:

| 観測項目 | 基準 |
|---|---|
| score 中央値（複数軸） | pre-DET から **±10 以上** 動く |
| verdict 分布 | "合格ライン" が **過剰**（pre-DET 比 2 倍以上）または "構造からやり直し" が **消失** |
| weakness が deterministic 検出と矛盾する | 例: AI が NG として認識すべき phrase に対し褒めている |
| AI 出力 parse failure 率 | pre-DET 比 **2 倍以上** |
| AI 出力 truncated 率 | pre-DET 比 **2 倍以上** |
| AI 出力 token 平均 | **+30% 以上**（深刻な context overhead） |
| `[ai cache]` hit rate が長期低下 | bump 後 2 週間経っても回復しない |
| 文体 / トーンの逸脱 | 称賛だらけ / 説教調 / 精神論が顕著 |
| 同一本文 re-submit で score が大きく振れる | DET-2 / DET-4 注入が AI の judgement を不安定化 |
| 開発者の品質感覚で **明らかな劣化** | — |

**判定**: 30 件 sample で 1 つでも該当 → rollback 検討フェーズへ移行。

---

## 9. rollback criteria（どの STEP をどう戻すか）

DET-2 / DET-3 / DET-4 はそれぞれ **独立 PROMPT_VERSION bump** で分離されているため、任意の 1〜2 STEP だけを部分 revert 可能。最初の検討は必ず "部分 revert"、全戻しは最後の手段。

### 9.1 DET-2 のみ revert（statement-review の NG 注入を戻す、DET-4 structure は維持）

**条件**: statement-review で:

- weaknesses が「NG section にある phrase だけ」になっている（AI が structure 注入を活かしきれていない）
- ただし structure section（DET-4）は正常に効いている

**手順**: [app/api/statement-review/route.ts](../../app/api/statement-review/route.ts) の `ngIssues:` 引数を 1 行削除し、PROMPT_VERSION を再 bump して cache を分離。または DET-2 commit を `git revert` してから DET-4 を re-apply する compaction PR。

### 9.2 DET-3 のみ revert（essay-review の structure 注入を戻す）

**条件**: essay-review で:

- verdict 分布が大幅に shift（特定 verdict 独占など）
- improvement の質が低下

**手順**: [app/api/essay-review/route.ts](../../app/api/essay-review/route.ts) の `structureSection` 注入を削除 + PROMPT_VERSION を再 bump。または DET-3 commit を `git revert`。

### 9.3 DET-4 のみ revert（statement-review の structure 注入を戻す、DET-2 NG は維持）

**条件**: statement-review で:

- 5 軸 score の中央値が崩れる（特に `originality` / `specificity`）
- ただし NG section（DET-2）は正常に効いている

**手順**: [app/api/statement-review/route.ts](../../app/api/statement-review/route.ts) の `structureAnalysis:` 引数を 1 行削除し PROMPT_VERSION を再 bump（DET-2 単独 v7 状態に戻る）。または DET-4 commit を `git revert`。

### 9.4 全戻し（DET-2 + DET-3 + DET-4 すべて revert）

**条件**:

- AI parse failure 率が pre-DET 比 **2 倍以上**
- 採点が著しく不安定（同一本文の再 submit で大きく score が振れる）
- 複数 STEP の問題が切り分けられない

**手順**: 3 つの DET commit を順番に `git revert`。PROMPT_VERSION は statement-review 6 / essay-review 2 に戻る。

### 9.5 共通注意

- 部分 revert 後も `[ai cache]` で 1 回 miss が発生する（PROMPT_VERSION を動かしているため）。intentional な 1 回損失として受け入れる
- revert 後 1 週間は再観測フェーズ。元のサイクルに戻したら次の STEP の検討に移る
- revert を実施したら本 doc §13 改訂履歴に記録（観測知見の蓄積）

---

## 10. DET-5 へ進む条件

下記すべて満たすとき進行可能:

1. **観測期間**: 最低 2 週間、推奨 3-4 週間が経過
2. **サンプル数**: route 別 30 件達成（statement-review / essay-review それぞれ）
3. **success criteria**: §6 の全項目を満たす
4. **failure / warning criteria**: §7 / §8 のいずれにも該当しない
5. **`cost()` 推移の安定性**: 過去 1 週間の `estimatedAvoidedTotalTokens` が単調変動でない（spike / drop なし）
6. **`[ai cache]` hit rate**: bump 直後の miss は解消、pre-DET 水準に戻った
7. **runtime 不具合ゼロ**: parse failure / 5xx / network エラー率に異常なし
8. **既存 doc 整合性**: [ai_validation_observability.md](./ai_validation_observability.md) / [validation_cost_calibration.md](./validation_cost_calibration.md) の数値感覚と矛盾しない

### DET-5 候補の優先度（参考）

§10 の条件を満たしたら DET-1 Top 10 残候補から:

| 優先 | 候補 | 理由 |
|---|---|---|
| 1 | A': NG 注入（statement-prepare） | 既存 lib 流用、DET-2 と同形、PROMPT bump 1 回 |
| 2 | E: `/api/analyze` 削除 | hygiene。cost 寄与なしだが maintenance ↓ |
| 3 | C: levelEvaluation heuristic（interview-feedback） | Easy だが ROI 中-低 |
| 4 | D: statement-prepare DB enrichment | university DB の事前整備が前提 |

優先度自体も観測フェーズの結果次第で見直す。

---

## 11. なぜ今観測フェーズが必要か

### 11.1 deterministic 補助の本質的リスク

DET-2 / DET-3 / DET-4 はすべて "AI に既知情報を渡す" 設計で、**AI に新タスクは増やしていない**が、次のリスクは runtime で観測しないと判断できない:

- AI が deterministic 検出を **過度に信頼**して本文を読み込まなくなる
- AI が deterministic 検出を **無視**して同じ judgement を繰り返す（→ token 削減効果ゼロ）
- prompt 容量増加で input cache 割引が効きにくくなる
- 5 軸 score 分布が "section を見ながら採点した" 結果として歪む

→ static review では検知できないため、実 AI 出力を見ながら判断する必要がある。

### 11.2 削減 vs 品質 のトレードオフ

DET-1 の予測では statement-review 単体で月 24K-36K tokens 削減見込み（[docs/principles/ai_validation_observability.md §8](./ai_validation_observability.md) の rough heuristic 同レンズ）。だが:

- 削減は **副次的目標**
- 主目標は AI が本来やるべき創造的責務（改善提案 / partial examples / 採点）の **質維持**
- 品質劣化 1% の代償で token 削減 10% を得ても、サービス価値を毀損する

→ DET-5 で更に candidate を追加する前に、既存 3 STEP の品質側面を確認するゲートが必要。

### 11.3 cache 安定化を待つ

DET-2 / DET-3 / DET-4 はそれぞれ PROMPT_VERSION bump を伴うため、bump 直後は **強制 cache miss** が発生する。本来の token 削減効果は cache が温まった後（同一入力の再投稿）でようやく現れる:

| 時期 | 状態 |
|---|---|
| bump 直後 | AI call 全件 miss → token 消費は **一時的に増加** する可能性 |
| 1-2 週間後 | cache hit が pre-DET 水準に戻る |
| それ以降 | deterministic 補助による prompt 効率化の実効果が見える |

→ 1 週間以内の判断は早すぎる。最低 2 週間の観測が必要。

### 11.4 DET-1 rough heuristic の校正

DET-1 完了報告の "月 24K-36K tokens 削減" は [docs/principles/validation_cost_calibration.md](./validation_cost_calibration.md) の固定 AVG token（input 1800 / output 900）に基づく推計。実観測値で校正することで、次フェーズ（DET-5）の ROI 評価精度が上がる。

### 11.5 検証フェーズが "次のフェーズの一部" である理由

DET-2 / DET-3 / DET-4 は **実装フェーズの完了**ではなく、**観測フェーズを含めた一連の STEP**。観測なしに次の候補に進むのは:

- 効果不明のまま改修を重ねる → どの STEP が品質を毀損したか切り分け不能
- rollback 判断材料が失われる
- ROI 推計が累積誤差を持つ

→ OBS-4 は "delivery" ではなく "validation gate"。

---

## 12. 関連ドキュメント

- [ai_validation_observability.md](./ai_validation_observability.md) — observability framework 正本（DET-2 / DET-3 / DET-4 の効果計測の数値レンズ）
- [validation_cost_calibration.md](./validation_cost_calibration.md) — AVG token calibration 手順（cost 推計値の校正）
- [ai_score_contract.md](./ai_score_contract.md) — score contract / PROMPT_VERSION bump ルール（rollback 時の bump 再運用）
- [ai_policy.md](./ai_policy.md) — AI 利用全般のポリシー
- [ai_cache_observability.md](./ai_cache_observability.md) — `ai cache` lane 仕様
- [ai_usage_observability.md](./ai_usage_observability.md) — `ai usage` lane 仕様
- [lib/detectNgWords.ts](../../lib/detectNgWords.ts) — DET-2 / 今後の A' で使う NG 検出
- [lib/structureAnalysis.ts](../../lib/structureAnalysis.ts) — DET-3 / DET-4 で使う 6 要素検出
- [lib/hash/statementReview.ts](../../lib/hash/statementReview.ts) — `STATEMENT_REVIEW_PROMPT_VERSION = 8`（DET-2 + DET-4 後）
- [lib/hash/essayReview.ts](../../lib/hash/essayReview.ts) — `ESSAY_REVIEW_PROMPT_VERSION = 3`（DET-3 後）

---

## 13. 改訂履歴

- 2026-05-29: 初版（OBS-4）。DET-2 / DET-3 / DET-4 の効果検証手順を確定。観測項目 / success / warning / failure / rollback criteria / DET-5 進行条件を明文化。runtime 変更ゼロ、docs only。
