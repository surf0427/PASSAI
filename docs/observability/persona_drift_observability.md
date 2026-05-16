# Persona Drift Observability 設計

PASSAI における **cross-feature 人格 drift** を将来的に観測可能にするための observability 設計書。
本ドキュメントは **設計のみ**（実装・logging・analytics・prompt・API route は変更しない）。

関連: [cross_feature_persona_consistency.md](../qa/cross_feature_persona_consistency.md), [student_profile_contract.md](../principles/student_profile_contract.md), [architecture_rules.md](../principles/architecture_rules.md), [ai_usage_observability.md](../principles/ai_usage_observability.md), [ai_cache_observability.md](../principles/ai_cache_observability.md), [lib/contextBuilders/README.md](../../lib/contextBuilders/README.md)

---

## 1. なぜ必要か

通常の observability（latency / crash rate / token cost / cache hit-miss）では、PASSAI の**本質的な failure**である**人格 drift**を検知できない。

| 既存 observability レーン | 担当 | 対象 |
|---|---|---|
| `ai usage` | [ai_usage_observability.md](../principles/ai_usage_observability.md) | 実際に AI を呼んだ時の token 量 |
| `ai cache` | [ai_cache_observability.md](../principles/ai_cache_observability.md) | AI 呼び出し回避（hit / miss） |
| platform metrics | Vercel / Datadog 等 | latency / error rate |
| **persona drift**（本書） | **未実装** | **feature 間の人格一貫性** |

PASSAI は「AI が文章を書く」ではなく「AI が**同一人物理解を維持する**」プロダクト。
**feature correctness と human consistency は別問題**であり、専用レーンの観測が要る。

---

## 2. 観測対象

| signal | 観測したいズレ |
|---|---|
| strengths divergence | feature ごとに主強みが入れ替わる |
| tone divergence | 語り口の温度（熱意／淡々／背伸び）が feature 間で別人化 |
| motivation divergence | 志望動機の核が feature 間で食い違う |
| activity interpretation divergence | 同じ活動が feature ごとに別カテゴリ／別主役で扱われる |
| future goal divergence | 将来像が feature ごとに別進路で語られる |
| university fit divergence | matching の判定と statement / interview の文脈が矛盾 |
| genericization | 出力テンプレ化で profile 固有性が消える |
| stale-profile silent drift | UI は最新だが下流が古い profile を読む |

---

## 3. canonical flow 上の drift point

```
ActivityData              ← raw 活動入力
   │
   ▼
WallHittingResult         ← /api/analysis 出力
   │   ⚠ A: raw 直流 — feature が WallHittingResult を直読み
   ▼
SummaryResult             ← /api/summarize 出力
   │   ⚠ B: stale profile — SummaryResult が canonical に未反映（self-pr stale 事故）
   ▼
StudentProfile            ← canonical 人格スナップショット
   │   ⚠ C: canonical bypass — feature が別 storage / cache を canonical 扱い
   ▼
Context Builders          ← lib/contextBuilders/{feature}*
   │   ⚠ D: context augmentation — builder が独自派生／AI 呼び／副作用
   ▼
Prompt Builders           ← lib/prompts/{feature}Prompt.ts
   │   ⚠ E: prompt drift — feature ごとの prompt 改修で persona 解釈がずれる
   │   ⚠ F: prompt 補完 — 「足りない情報は推測しろ」型の指示
   ▼
Outputs                   ← API route の出力
       ⚠ G: feature-specific optimization — feature 単独最適化で人格崩壊
```

drift point とレイヤの対応:

| Point | レイヤ | 典型例 | 関連 |
|---|---|---|---|
| A | raw 直流 | `loadWallHittingResult()` を feature から直接呼ぶ | [student_profile_contract.md §8](../principles/student_profile_contract.md) |
| B | canonical 未更新 | 深掘り修正後の summary 未 patch | [student_profile_contract.md §5](../principles/student_profile_contract.md) |
| C | canonical bypass | feature 専用 storage に人格を持つ | [student_profile_contract.md §11](../principles/student_profile_contract.md) |
| D | context augmentation | Context Builder で AI 呼び／派生フィールド作成 | [lib/contextBuilders/README.md §5](../../lib/contextBuilders/README.md) |
| E | prompt drift | PROMPT_VERSION bump 時に persona 解釈が変わる | [ai_score_contract.md](../principles/ai_score_contract.md) |
| F | prompt 補完 | prompt 内で AI に persona を推測させる | [cross_feature_persona_consistency.md §12](../qa/cross_feature_persona_consistency.md) |
| G | feature 最適化 | 各 feature が「受けが良い人物像」に寄せる | [cross_feature_persona_consistency.md §7](../qa/cross_feature_persona_consistency.md) |

---

## 4. Persona Drift の定義

drift を 3 段階に分類。**「別表現」と「別人格」を分離する**。

| 段階 | 定義 | 例 | 対応 |
|---|---|---|---|
| **acceptable variation** | 表現揺れ。core identity 一致 | 「主体性」を「自分から動く力」と言い換える | 観測のみ。alert しない |
| **soft drift** | 順序・強調が feature 間で食い違う。核は残るが粒度ズレ | self-pr の主強みが statement では補助に下がる | trend として観測。閾値超過で notice |
| **hard drift** | core identity conflict — 同一人物として読めない | 主強み入れ替わり／活動カテゴリ入れ替わり／将来像分裂 | alert。原因 drift point（§3 A〜G）を特定 |

判定原則は [cross_feature_persona_consistency.md §8](../qa/cross_feature_persona_consistency.md) と一致。**「人格一貫性 ≠ 完全同一文面」「人格 drift ≠ AI hallucination」**。

### 4.1 人格 drift と AI hallucination の違い

|  | 人格 drift | AI hallucination |
|---|---|---|
| 何が起きるか | feature 間で同一人物の解釈が分裂 | AI が事実でない情報を生成 |
| 原因 | canonical 同期不全 / prompt drift / feature 最適化 | model の確率的生成限界 |
| 検知レーン | cross-feature 比較 | output と input の整合検証 |
| 本書の対象 | ○ | ✕（別 observability レーン） |

---

## 5. 観測したい signal（実装はまだしない）

将来の lightweight 観測候補。具体 metric や log payload は **本書では決め打たない**:

| signal | 何を見るか |
|---|---|
| strengths overlap ratio | feature 間で主強み上位 N の集合重なり率 |
| recurring keyword continuity | valueKeywords が feature 出力に出現し続けるか |
| tone stability | 温度感（情熱／淡々／背伸び）が feature 間で安定か |
| motivation continuity | 志望動機の核（futureConnections 由来）が継続するか |
| narrative continuity | 過去 → 現在 → 将来 の語りが feature 横断で同一線上か |
| feature contradiction count | 同属性が逆転（強み ↔ 弱み）する件数 |
| stale-profile detection | StudentProfile.sourceHash と feature 出力タイミングの ズレ |

**重要**: 上記はまだ metric ではない。実装は [ai_cache_observability.md](../principles/ai_cache_observability.md) と同様、消費者が現れた PR で初めて配線する。

---

## 6. feature 別観測観点

### 6.1 self-pr
- strengths wording — StudentProfile.strengths の主軸との一致
- episode reuse — signatureEpisodes が他 feature と整合
- tone — interview / statement と整合する語り口

### 6.2 statement
- university alignment — 受験大学 / 学部 / 受験方式との整合
- motivation framing — futureConnections と志望動機の核の一致
- problem awareness — weaknesses 言及との整合

### 6.3 interview
- spoken narrative — 自己紹介が self-pr / statement と同じ核を持つ
- weakness explanation — 弱み回答が他 feature と矛盾しない
- growth narrative — 過去 → 現在 → 将来 の語りが statement と整合

### 6.4 matching
- recommendation basis — 推薦根拠が strengths / futureConnections と整合
- admission-type interpretation — 受験方式の解釈が statement / interview と一致

### 6.5 共通
- StudentProfile.sourceHash 同一状態での feature 横断 core identity 一致
- canonical patch 後の全 feature 反映遅延

---

## 7. Stale profile observability

2026-05 self-pr stale 事故が示した重要な observability ギャップ:

- **UI は最新**（活動まとめページに新しい summary が表示される）
- **canonical profile は古い**（StudentProfile.summary / strengths が未 patch のまま）
- **下流 feature は古い profile を読む**（self-pr が stale な strengths を seed に使う）

これは **silent drift**: API は 200 を返し、token cost も正常、cache miss / hit も normal。通常 monitoring では一切検知できない。

検知のヒント（将来の signal 候補）:
- `StudentProfile.sourceHash` と `analyzeState.summary` の片方だけが更新されたタイミング
- summarize 成功 log と studentProfile 更新の **間隔 / 欠落**
- feature 出力に含まれる core identity が `StudentProfile` 由来ではなく `SummaryResult` 由来のみで構成された痕跡

**現時点では検知レーンは未実装**。QA（[cross_feature_persona_consistency.md §6 S2 / S3](../qa/cross_feature_persona_consistency.md)）でカバー。

---

## 8. 将来的な lightweight instrumentation 案（未実装）

実装するなら以下の identifier を payload に含める想定。**具体 payload shape は本書で確定させない**:

| 候補 field | 意味 |
|---|---|
| `profileHash` | StudentProfile.sourceHash（既存 field） |
| `profileGeneratedAt` | StudentProfile.generatedAt（既存 field） |
| `contextHash` | Context Builder 出力の hash（将来 builder に追加） |
| `promptVersion` | feature の PROMPT_VERSION（既存定数を流用） |
| `featureContextVersion` | builder のバージョン（将来追加） |
| `outputSnapshotHash` | feature 出力の identity 抽出後の hash（PII 排除） |

### 8.1 PII / 生テキスト保存方針

**生テキスト・志望理由書本文・面接回答・self-pr 全文を log に乗せない**:
- hash 化（identity 抽出後のみ）／削除を default にする
- 集計に必要なのは「人格 identity の差分」であり、本文ではない
- platform 側の log retention / アクセス権限は [ai_usage_observability.md](../principles/ai_usage_observability.md) と整合

### 8.2 既存 log key との分離

将来追加するなら新 log key（例: `persona drift`）を別 stream として確保する。`ai usage` / `ai cache` の payload shape を汚染しない。

---

## 9. 将来的な drift detection 案（未実装）

future vision のみ。具体実装は別 STEP:

| 案 | 内容 | 依存 |
|---|---|---|
| D1. snapshot diff | 同一 profileHash での feature 出力 identity を保存し PR 前後で diff | snapshot 保存基盤 |
| D2. cross-feature overlap | feature 間で identity 軸（主強み／主活動／将来像）の重なりを集計 | identity 抽出器 |
| D3. consistency scorer | 軽量 AI 評価器で core identity 一致度をスコア化 | 評価 prompt 設計が別 STEP |
| D4. regression detection | PROMPT_VERSION bump 前後で identity の安定性を比較 | [ai_score_contract.md](../principles/ai_score_contract.md) の PROMPT_VERSION 運用と接続 |

実装順序の前提: identity 抽出器（D1〜D3 共通基盤）→ scoring → alert ルール。
**今は何もしない**。手動 QA（[cross_feature_persona_consistency.md](../qa/cross_feature_persona_consistency.md)）で代替する。

---

## 10. StudentProfile contract との関係

[student_profile_contract.md](../principles/student_profile_contract.md) は本 observability の **規範文書**:

- canonical profile が drift 抑制の中心
- drift 検出時は次の順で疑う:
  1. **stale cache** — cache hit 経路で canonical patch が走っていない（drift point B）
  2. **partial patch failure** — patch source が canonical の richer field を潰した（[student_profile_contract.md §5.3](../principles/student_profile_contract.md)）
  3. **adhoc merge** — feature 側で profile + 別 storage を独自合成（[student_profile_contract.md §11](../principles/student_profile_contract.md)）
- contract が守られていれば drift point A〜C は構造的に発生しない

---

## 11. Context Builder Layer との関係

[lib/contextBuilders/README.md](../../lib/contextBuilders/README.md) で導入された層は本 observability の **3 つの境界**として機能する:

| 機能 | 内容 |
|---|---|
| **drift isolation** | feature 固有の persona 解釈差分を builder 内に閉じ込める。route.ts / prompt builder に漏らさない |
| **drift localization** | drift 検出時、どの feature の builder が原因かを 1 ファイル単位で特定可能 |
| **observability boundary** | 将来 instrumentation を仕込む場所として最適（canonical 直後・prompt 直前の境界） |

ただし Context Builder が独自フィールドを派生させると drift point D が発生する。builder の責務は trim / 重み付け / 整形に限定（[lib/contextBuilders/README.md §6](../../lib/contextBuilders/README.md)）。

---

## 12. QA との違い

| 観点 | QA（[cross_feature_persona_consistency.md](../qa/cross_feature_persona_consistency.md)） | Observability（本書） |
|---|---|---|
| 実行者 | 人間 | 本番システム（将来） |
| タイミング | リリース前 / 手動 trigger | 継続実行 |
| 対象 | 12 シナリオ S1〜S12 | 全本番 trafic |
| 出力 | 比較表 / minor-moderate-severe 判定 | log signal / metric trend |
| 役割 | 既知シナリオで drift を **発見** | 未知シナリオの drift 傾向を **継続観測** |

両者は補完関係。QA は深掘り（known unknown）、observability は広域（unknown unknown）。

---

## 13. Anti-pattern

本 observability で検出すべき / 構造的に防ぐべきパターン:

- **feature ごとに別人格最適化** — 各 feature が「受けが良い人物像」に寄せて合計人格が崩壊
- **prompt 内人格補完** — 「足りない情報は推測してください」型の prompt
- **stale profile 放置** — canonical patch を cache hit 経路で省く（self-pr 事故と同型）
- **generic strengths injection** — profile が薄い時に「協調性」「主体性」を雛形注入
- **hidden fallback** — feature 内で「profile が無ければ別 storage から復元」する隠れ経路
- **context mutation** — Context Builder が StudentProfile を mutate（純粋関数規約違反）
- **生テキスト直 logging** — 志望理由書本文や面接回答を log に残す（PII / cost 問題）
- **observability の過剰実装** — 「全 metric を一気に入れる」型の予防的計装

---

## 締めくくり

**PASSAI の observability は system health だけでなく、human consistency health を扱う**。
latency / error / token は system health の指標であり、PASSAI の本質的価値である「同一人物理解の維持」を担保しない。
人格 drift を観測可能にすることが、PASSAI を「一貫した進路相談相手」として成立させるための前提となる。
