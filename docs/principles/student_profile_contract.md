# StudentProfile Contract

PASSAI における **canonical student snapshot** としての StudentProfile の責務・更新方針・source of truth 階層を固定化する規約。
今後の Supabase 化・context builder layer 導入・新 feature 追加時に「人格データの破綻」を予防するための前置き契約。

関連: [architecture_rules.md](./architecture_rules.md), [incremental_refactor_policy.md](./incremental_refactor_policy.md), [ai_policy.md](./ai_policy.md)

---

## 1. 目的

- **PASSAI 全体で「学生という人格」を 1 つだけ持つ**ための共通中立レイヤを定義する
- 「自己分析の出力をどの feature がどう読むか」を feature 側に毎回判断させない
- WallHittingResult（壁打ちフロー内部の working state）を下流に直流さない緩衝層を作る
- Supabase 移行時に「全 feature の人格データを 1 箇所で持ち上げる」ための足場を確保する

直接の動機は 2026-05 の self-pr stale profile 不具合（深掘り修正後の SummaryResult が studentProfile に反映されず、self-pr が古い strengths を読み続けた事故）。原因は「StudentProfile が canonical なのか cache なのか」が曖昧だったこと。

---

## 2. 現在の位置づけ

StudentProfile は **PASSAI における canonical student snapshot** である。

- downstream feature（statement / interview / matching / self-pr / essay）は StudentProfile を読む
- feature ごとの独自人格状態を持たない（feature artifact は別 storage / 別 type）
- user understanding（学生の自己理解の現在地）の共有レイヤ
- 「derived cache」ではない。書き手は限定されるが、書き換え可能な canonical artifact として扱う

実体: `types/studentProfile.ts` の `StudentProfile`、保存層は `lib/studentProfileStorage.ts`。

---

## 3. Source of truth 階層

```
WallHittingResult       (raw)         ← /api/analysis の生出力。questions/answers を含む working state
        │
        ▼
SummaryResult           (derived)     ← /api/summarize の出力。activitySummary / strengths / appealPoints
        │
        ▼
StudentProfile          (canonical)   ← 下流共通の人格スナップショット
        │
        ▼
Feature Context Builders (feature-facing) ← lib/contextBuilders/*（将来構想）
        │
        ▼
Prompt Builders         (feature-facing) ← lib/prompts/*
```

| 層 | 分類 | 書き手 | 読み手 |
|---|---|---|---|
| WallHittingResult | raw | `/api/analysis` | self-analysis page / toStudentProfile() |
| SummaryResult | derived | `/api/summarize` | self-analysis page / StudentProfile patch |
| StudentProfile | **canonical** | self-analysis page（新規 + patch） | 全 downstream feature |
| Context Builder | feature-facing | （将来 `lib/contextBuilders/`） | Prompt Builder |
| Prompt Builder | feature-facing | `lib/prompts/*` | API route |

**重要**: raw / derived を downstream に直接流さない。必ず StudentProfile を経由する。

---

## 4. StudentProfile に入れてよいもの

`types/studentProfile.ts` の現スキーマ:

| フィールド | 種別 | 役割 |
|---|---|---|
| `version` | meta | 互換性管理（破壊変更で bump） |
| `generatedAt` | meta | スナップショット時刻 |
| `sourceHash` | meta | 再生成判定 / dedup guard |
| `summary` | content | 学生の概要（1 段落） |
| `strengths` | content | 強み（優先度順、`string[]`） |
| `weaknesses` | content | 弱み（優先度順、`string[]`） |
| `futureConnections` | content | 将来との接続（`string[]`） |
| `valueKeywords` | content | 価値観タグ（deterministic 抽出） |
| `signatureEpisodes` | content | 具体エピソード（最大 3 件） |

**入れないもの**:
- `questions` / `answers`（壁打ちフロー working memory）
- `selfPRDraft` / `interviewPoints` / `statementDraft`（feature artifact）
- feature-specific transient state（編集中テキスト・UI step・cache key 等）
- AI 呼び出しに失敗した部分結果

「下流共通に渡って意味がある中立な学生像」だけを含める。

---

## 5. 更新ポリシー

StudentProfile の書き換えは以下を守る。今回の self-pr 不具合修正（C-lite）の設計思想でもある。

### 5.1 partial patch を default にする

- **overwrite より partial patch**を優先する
- richer field（SummaryResult に対応概念がないもの）を失わせない
- 既存値を起点に、明示した field だけ差し替える

### 5.2 canonical patch source

- 新規分析時: `WallHittingResult` → `toStudentProfile()` で全置換（初期化扱い）
- 深掘り修正時: `SummaryResult` を canonical patch source として **summary / strengths のみ** patch
- 将来 SummaryResult が拡張されても、StudentProfile に意味的対応がある field だけが patch 対象

### 5.3 null / empty overwrite を避ける

- patch 値が空文字 / 空配列なら existing 側を維持する
- 「AI が今回返さなかった field を 0 で潰す」ことを禁止
- 例: `nextStrengths.length > 0 ? nextStrengths : existing.strengths`

### 5.4 stale を下流に流さない

- 上流（self-analysis）で再生成が起きたら、**同一トランザクション内で StudentProfile を patch する**
- 「state は更新したが localStorage を後で書く」のような遅延は禁止
- cache hit 経路でも canonical sync を忘れない（§7 参照）

---

## 6. overwrite 禁止領域

SummaryResult からの patch で **絶対に上書きしない** field:

| field | 理由 |
|---|---|
| `futureConnections` | WallHittingResult 固有素材。SummaryResult に対応概念なし |
| `signatureEpisodes` | strengths から派生済み。再派生で title/summary が劣化する |
| `weaknesses` | SummaryResult に対応概念なし |
| `valueKeywords` | deterministic 抽出済み。Re-derivation で過去 tag を失うリスク |
| `version` | スキーマ移行ルールに従う |

ルール: **SummaryResult に存在しない field は、SummaryResult 由来の patch では一切触らない**。
新規 patch source（将来追加されうる別 API 出力）を導入する際も、同じ原則を適用する。

---

## 7. cache / storage 方針

- localStorage は **transport / cache 層**。canonical な真実は「StudentProfile という contract」そのもの
- `summarizeCache` / `additionalQuestionsCache` は AI 入力 hash でヒット判定する derived cache
- **cache hit でも canonical sync は必須**。今回の self-pr 不具合では cache hit 経路で StudentProfile patch を忘れると stale が永続化する
- `saveStudentProfile` の dedup guard（`sourceHash` 一致時 skip）は「同じ入力での無駄書き込み抑制」のためであり、stale を許容するためではない

storage key 一覧は [`lib/storage/README.md`](../../lib/storage/README.md) / [`docs/shared/localstorage_keys.md`](../shared/localstorage_keys.md) を参照。

---

## 8. downstream feature rule

| feature | 読み方 |
|---|---|
| self-pr | `getStudentProfileForFeature()` → `buildSelfPRDraftSeed()` |
| interview | StudentProfile → 質問生成 prompt |
| matching | StudentProfile → 学部マッチング推論 |
| statement | StudentProfile → prepare/score/improve の素材 |
| essay | StudentProfile → essay 添削の人格コンテキスト |
| 将来の AI counselor | StudentProfile → 相談 prompt |

**ルール**:

1. feature は独自人格を持たない。StudentProfile を読む
2. feature 内で人格データを派生キャッシュしない（毎回 StudentProfile から派生）
3. feature が「もっと豊かな人格情報」が欲しい場合は StudentProfile を拡張する PR を作る（feature 側で独自フィールドを足さない）
4. WallHittingResult / SummaryResult を feature が直読みするのは禁止（fallback 経路として `getStudentProfileForFeature` 内で吸収する）

---

## 9. 将来的な Supabase 方針（未実装）

現在は localStorage ベース。将来の Supabase 移行に向けて以下を確保する:

- StudentProfile の書き手 / 読み手はすべて `lib/studentProfileStorage.ts` の export を経由する（直接 `localStorage.*` 禁止）
- 移行時の作業範囲は **このファイル 1 枚の置換**で済むこと
- double-write 期間: localStorage / Supabase の両方に書く期間を設ける（[architecture_rules.md §TODO](./architecture_rules.md) と整合）
- `sourceHash` は移行後も再生成判定 / sync 判定に流用する
- 詳細な migration 戦略は [incremental_refactor_policy.md](./incremental_refactor_policy.md) の Supabase TODO で別途策定

**現時点では実装しない**。contract を先に固定することが目的。

---

## 10. Context Builder Layer との関係

将来構想として `lib/contextBuilders/` を導入する場合の責務分担:

```
StudentProfile                          ← canonical 人格
        ↓
Feature-specific Context Builder        ← lib/contextBuilders/{feature}.ts（将来）
        ↓                                  ・StudentProfile + activityData + basicInfo を feature 用に合成
        ↓                                  ・university DB 接続等の副作用もここで吸収
Prompt Builder                          ← lib/prompts/{feature}Prompt.ts（既存）
        ↓
API Route
```

- Context Builder は StudentProfile を**読むだけ**（書き換え禁止）
- Context Builder は feature 都合の整形 / フィルタ / DB 結合を担う
- 既存の `buildXxxUniversityContext` 系 5 ファイルは [incremental_refactor_policy.md §T5](./incremental_refactor_policy.md) で 6 ファイル目追加時に `contextBuilders/universityDb/` 配下へ集約予定
- 現時点では新規ディレクトリを切らない（trigger 未発火）

---

## 11. Anti-pattern

以下は **禁止**:

- feature ごとの人格分裂（self-pr 専用 profile / interview 専用 profile を別 storage で持つ）
- adhoc merge（feature 側で `profile + analyzeState + wallHittingResult` を毎回手で混ぜる）
- stale cache を canonical より優先（cache hit 経路で StudentProfile patch を省く）
- prompt 側で人格補完（「strengths が空なら AI に推測させる」のような prompt fallback）
- raw WallHittingResult 直読み乱立（feature が `loadWallHittingResult()` を直接呼ぶ。`getStudentProfileForFeature` の fallback 経路以外では禁止）
- 「SummaryResult が空文字を返したから profile も空にする」型の null/empty overwrite
- StudentProfile に feature artifact を混ぜる（selfPRDraft / interviewPoints 等）
- `sourceHash` の手動偽装（dedup guard を意図的に騙して再保存を強制する）
  - 例外: patch source が変わった旨を表現する prefix 付き hash（`summarize:${inputHash}` 等）は許可

---

## 締めくくり

現在 PASSAI は localStorage ベースで動いているが、**contract を先に固定することで storage backend を後から交換可能にする**。
StudentProfile を「canonical な学生像」として揺るがせないことが、Supabase 化・context builder layer 導入・新 feature 拡張のすべてに先立つ前提となる。

実装が contract に追従しなければ contract を更新する（実装を歪めるためではなく、実装が現実に合わせて成熟した結果として）。逆向き — contract に書いてないからといって自由に拡張する — は禁止。
