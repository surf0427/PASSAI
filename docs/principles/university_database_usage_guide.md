# 大学DB 利用ガイド

PASSAI における大学データベースの利用ルール・方針の **正本**。

コード上の境界は [lib/universities.ts](../../lib/universities.ts)、データの実体は [data/universities.ts](../../data/universities.ts) / [data/universityEntries.ts](../../data/universityEntries.ts) / [data/universityMaster.ts](../../data/universityMaster.ts) / [data/selectionSteps.ts](../../data/selectionSteps.ts) / [data/updateLogs.ts](../../data/updateLogs.ts) に置かれている。本書は **「いつ・どのデータを・どこ経由で・どこまで AI に渡すか」を機能横断で固定する** ためのガイドである。

`lib/README.md` および各データファイル冒頭コメントは本書を参照する補助情報であり、ルールの正本は本書とする。

---

## 1. 現在の DB 構造

DB は 5 つのレイヤーで構成される（旧 matching 用 + 新 4 系統。新 4 系統は実データ 3 + メタ情報 1）。

```
page / route / components
        │  (直接 import 禁止)
        ▼
   lib/universities.ts          ← 唯一の読み取り境界
        │
        ├─→ data/universities.ts          (旧: matching 用、~25 件、学部単位)
        ├─→ data/universityMaster.ts      (新: 大学マスタ、24 件、学校単位)
        ├─→ data/universityEntries.ts     (新: 入試方式DB、~532 件、入試方式単位)
        ├─→ data/selectionSteps.ts        (新: 選考ステップ詳細、~466 件、選考フロー単位)
        └─→ data/updateLogs.ts            (新: 更新ログ、初期は空、メタ情報レイヤ)
```

| レイヤー | ファイル | 役割 |
|---|---|---|
| boundary | `lib/universities.ts` | 唯一の読み取り境界。Supabase 移行時はここの中身だけを差し替える |
| 旧データ | `data/universities.ts` | matching 機能専用。`types/matching.ts` の `University` 型に従う |
| 新データ（学校単位） | `data/universityMaster.ts` | 大学マスタ。`UniversityMaster` 型を **同ファイル内 inline 定義**。`universityEntries` と `school_id` で結合する想定 |
| 新データ（入試方式単位） | `data/universityEntries.ts` | CSV 由来。`UniversityEntry` 型を **同ファイル内 inline 定義** |
| 新データ（選考ステップ単位） | `data/selectionSteps.ts` | CSV 由来の選考フロー詳細。`SelectionStep` 型を **同ファイル内 inline 定義**。`universityEntries` と `entry_id` で結合する想定 |
| 新データ（更新履歴・メタ情報） | `data/updateLogs.ts` | DB 変更履歴。`UpdateLog` 型を **同ファイル内 inline 定義**。`target_type` + `target_id` で任意レイヤーへの soft FK。**実データではなくメタ情報** |

新 4 系統はすべて **`types/` には未切り出し**、**現状どこからも import されない**。5 ファイル併存は意図的な状態で、統合は Supabase 移行と同タイミングで判断する（今は触らない）。

### 新 4 系統の責務分離

| 観点 | `UniversityMaster` | `UniversityEntry` | `SelectionStep` | `UpdateLog` |
|---|---|---|---|---|
| granularity | 大学単位（1 大学 = 1 行） | 入試方式単位（1 入試方式 = 1 行） | 選考ステップ単位（1 step = 1 行） | 更新イベント単位（1 ログ = 1 行） |
| 件数 | 24 | 約 532 | 約 466 | 0（初期空） |
| 含む情報 | 学校単位で安定する属性（公式 URL / 都道府県 / 国公私立 / 系統 等） | 募集要項に依存する属性（入試方式 / 評定条件 / 面接有無 / 出願期間 / 選抜詳細 等） | 選考フローの順序情報（書類 → 小論文 → 面接 等。各 step の形式・時間・評価観点・AI 対策メモ・出典 URL） | DB 変更の事実（誰が・いつ・何を・どこから・confidence_score は） |
| 性質 | 実データ | 実データ | 実データ | **メタ情報** |
| 主キー | `school_id` | `entry_id` | `detail_id` | `log_id` |
| 結合キー | — | `school_id`（FK to master） | `entry_id`（FK to entry）+ `step_no`（順序） | `target_id`（任意のレイヤーへの soft FK、`target_type` で識別） |
| 含めないもの | 入試方式・評定条件・面接有無・出願期間など | 大学公式 URL・都道府県・国公私立・系統など | 過去問本文 / 面接質問例 / 評価重み（数値）/ 合否情報 | 個別の `old_value` / `new_value` 詳細、change_diff（JSON）、git_commit_hash 等 |

`universityEntries.has_interview` / `has_essay` 等の boolean 風カラムは `SelectionStep` から再導出可能だが、**重複を許容して両方残す**（正規化禁止方針）。`UpdateLog` は実データの値を直接変更せず、変更の **事実だけを別レイヤー**に記録する。

### 各レイヤーの値の埋まり具合（現時点）

| レイヤー | 実値の埋まり方 |
|---|---|
| `universities.ts` | 全フィールド実値（既存 matching 用） |
| `universityMaster.ts` | `school_id` と `university_name` のみ実値。残り 7 列は空欄。**AI 推測で埋めない**。enrich は別 PR |
| `universityEntries.ts` | CSV のまま（空欄 / `不明` / `あり` / `なし` / 日付ゆれ / Excel シリアル / 暫定 ID 等を保持） |
| `selectionSteps.ts` | CSV のまま（空欄 / 重複 `admission_policy` / 混在表記 / URL を保持） |
| `updateLogs.ts` | **空配列**（土台のみ）。今後の運用（CSV 再投入 / AI 自動取得 / 人間レビュー）で行が追加されていく想定 |

### `UpdateLog` の運用方針（参考）

将来この層を消費する helper / cron / レビュー UI を実装する際の前提:

- `confidence_score` は **`string` で保持**。閾値判定（例: 0.85 以上 = 自動承認）は consumer 側で `Number()` する。今は値を持つだけで判定しない
- `target_type` / `update_type` / `update_source` は **enum / Union を切らない**。CSV 由来の自由文字列として保持し、判定は consumer 側
- 個別フィールドの `old_value` / `new_value` 詳細、change_diff（JSON）、git_commit_hash 等は今期持たない（運用ポリシー策定後に追加）
- `UpdateLog` 行の追加 / 編集 / 削除を行うコードは**今は書かない**。この層は将来の cron / CSV 再投入 / 手動レビュー UI が書き手になる想定の **読み取り側土台**
- Supabase 移行時、`master` / `entries` / `steps` はテーブル化、`updateLogs` は **time-series テーブル**として独立。schema は維持

### `step_no` の扱い方

- CSV 内では各 `entry_id` ごとに `1`, `2`, `3` と昇順
- **string で保持**（`"1"` / `"2"`）。consumer 側で `Number(step_no)` する
- 同一 `entry_id` 内で `step_no` 重複・欠番が出ても **自動で番号振り直しはしない**（CSV のまま）
- ソートは将来 helper（例: `getStepsForEntry`）が必要になった段階で実装

---

## 2. 中央規約

### page / route / components のアクセス禁止事項

- ❌ `data/universities.ts` を直接 import する
- ❌ `data/universityEntries.ts` を直接 import する
- ❌ `data/universityMaster.ts` を直接 import する
- ❌ `data/selectionSteps.ts` を直接 import する
- ❌ `data/updateLogs.ts` を直接 import する
- ✅ `lib/universities.ts` の export 関数経由でのみアクセスする

### matching 機能と他機能の差

| 機能 | DB アクセス | 理由 |
|---|---|---|
| matching | **全件参照**（`getAllUniversities()` 経由） | DB 全体から候補を抽出する性質上、全件が必要 |
| matching 以外 | **ユーザー入力に紐づく分のみ** | AI に渡す情報を最小化し、API コスト / レイテンシ / 出力ブレを抑える |

matching が **唯一の例外**。新機能で「DB 全件を読みたい」と感じたら、その判断はほぼ間違っている。最初に疑うこと。

### AI への渡し方原則

1. **DB 全体を AI プロンプトに渡さない。** `build{Feature}UniversityContext` 経由で必要最小限に絞ってから渡す
2. **`null` / 空欄フィールドは prompt に含めない。** 空文字も渡さない
3. **DB 未登録の場合 AI に推測させない。** 「DB 未登録 / 大学公式サイトで確認が必要」として扱う
4. **複数候補がある場合、勝手に 1 件に絞らない。** 候補として返し、UI 側で扱うか、方式横断の共通情報を優先する

---

## 3. 機能別 DB 利用方針

各機能で **AI に渡す候補フィールド（参考）**。実装時はさらに最小化する。

### statement (志望理由書支援)

大学名 / 学部 / 学科 / アドミッションポリシー / 学びの特徴 / 求める人物像 / 選抜方式 / 出願条件 / 評価観点

### interview (面接練習)

大学名 / 学部 / 学科 / アドミッションポリシー / 面接有無 / 面接形式 / 過去質問 / 評価観点 / 志望理由で問われやすい点

### essay (小論文支援)

小論文有無 / 小論文テーマ / 課題文型 or テーマ型 / 評価観点 / 学部学科の分野 / アドミッションポリシー

### self-analysis (自己分析)

志望学部 / 志望学科 / 求める人物像 / アドミッションポリシー / 活動と接続しやすい観点

### matching (志望校マッチング) ── 全件参照の例外

大学名 / 学部 / 学科 / 入試方式 / 出願条件 / 評定条件 / 資格条件 / 選抜方式 / 活動評価 / 小論文有無 / 面接有無 / 書類有無

---

## 4. 例外対応方針

将来 helper を実装するときの前提。今は実装しないが、**設計時にこれらのケースを必ず想定する**こと。

### 入力の粒度差

| ケース | 対応方針 |
|---|---|
| 大学名のみ | 大学単位で候補を返す。複数学部があっても自動で 1 件に絞らない |
| 大学+学部のみ | 学部単位で候補を絞る。複数学科があっても自動で 1 件に絞らない |
| 大学+学部+学科 | 該当候補を返す。同一大学・学部・学科で入試方式が複数ある場合、方式別に候補を残す |

### 表記ゆれ

| 種類 | 例 | 今期の対応 | 将来 |
|---|---|---|---|
| 大学名 / 略称 | 青学 / 青山学院 / 青山学院大学 | **完全一致のみ**。alias DB は作らない | alias テーブル追加可 |
| 学部の表記 | 国際文化学部 / 国際文化 | 完全一致のみ。fuzzy search なし | 正規化関数を 1 段挟む形を予約 |
| 学科の有無 | `国際文化学科` / 学科記述なし | helper 側で「学科なし」を許容する戻り値設計 | 同上 |

helper のシグネチャは「**正規化関数を 1 段挟める形**」にしておくこと（差し替え可能な余地を残す）。

### 入試方式・年度

| ケース | 対応方針 |
|---|---|
| 同一学部・学科で入試方式が複数 | 方式別に候補を残す。志望理由書・面接など方式非依存の機能には方式横断の共通情報を優先する |
| 入試年度 | 現データには年度フィールドが無い。今は導入しない。helper 引数に `{ year?: number }` option を後付けできる形を想定 |

### データの欠損

| ケース | 対応方針 |
|---|---|
| DB 未登録 | `null` / 空配列で返す。`status: 'not_found'` のような状態を併記する形を想定。helper 内で「推測」しない |
| 個別フィールドが空欄 / `不明` / `null` | その項目は prompt に含めない。AI に「不明」「要確認」として扱わせる |

---

## 5. master の enrich 方針

`universityMaster` は将来「学校単位の安定属性」を載せる土台として置かれている。enrich を行う際は以下を守る:

- **AI 推測で埋めない。** 公式 HP / 文科省一覧 / 別 CSV など、出典の明確なソースから埋める
- **schema を肥大化させない。** 追加カラムを増やすより、空欄を埋めるほうを優先する
- **`faculty master` / `department master` / `admission master` への分割は今期しない。** Supabase 移行と同タイミングで再検討
- **enrich は別 PR で。** master 追加と enrich を同 PR でやらない（diff レビューが困難になる）
- **`universityEntries` から master へのカラム移動は今期しない。** 両者の責務境界を意図的に引き直す PR でのみ行う

---

## 6. 将来追加予定 helper

**消費者が現れた機能から 1 つずつ追加**する。先回りで全部作らない。**空関数 / 型定義の先行追加も禁止**。

```
findUniversityByPreference(pref)
findUniversitiesByUserChoices(basicInfo)
buildStatementUniversityContext(basicInfo)
buildInterviewUniversityContext(basicInfo)
buildEssayUniversityContext(basicInfo)
buildSelfAnalysisUniversityContext(basicInfo)
buildMatchingUniversityContext(basicInfo)
```

戻り値の形（`University` 単体 / 候補配列 / `{ context, candidates, status }` 等）は **最初の消費者が出る PR で確定** させる。先回りで型を切らない。

---

## 7. 現在まだやらないこと

優先度の高いものから順に、**全部今は禁止**:

- ❌ Supabase 接続 / 同期 → 非同期化
- ❌ feature-specific context builder の実装（消費者が現れたら 1 機能ずつ）
- ❌ alias DB / fuzzy search の実装
- ❌ DB 正規化 / カラム整理 / 入試方式別レコードの統合
- ❌ helper の大量追加
- ❌ 全機能への一括接続
- ❌ AI prompt の大学DB 関連変更
- ❌ matching ロジックの変更
- ❌ `types/` への `University` / `UniversityEntry` 型の先行切り出し
- ❌ repository pattern の導入

各項目の解禁条件は本書ではなく、**各機能の active 開発状況・Supabase 移行の進捗・最初の消費者の登場による**（PR ごとに判断）。

---

## 8. DB の出処と更新サイクル（参考）

`data/universityEntries.ts` の元データは **AO・公募入試DB テンプレート（Excel/CSV）** で、以下の運用サイクルで更新される。コードに直接の関係はないが、列名・値表現を維持する根拠として記録する。

- **更新タイミング**: 毎年 8〜9 月（各大学の募集要項公開後）に AI で一括更新
- **ID 体系**: `school_id = U001…` / `entry_id = E0001…` の連番
- **信頼度 (`confidence_score`)**: 0.85 以上 = 自動承認、未満 = 人間確認フラグ。現状 CSV では空欄
- **想定 RAG フロー**: 大学 HP の PDF → テキスト抽出 → Claude API で JSON 構造化 → confidence_score 付与 → Embedding 投入

Supabase 移行時は上記サイクルが DB にそのまま入る前提なので、**CSV 列名と値表現は現状を維持する**こと（boolean coercion / 列の rename / 不明値の null 化などはすべて禁止）。

---

## 9. 関連ファイル / ドキュメント

| 場所 | 役割 |
|---|---|
| [lib/universities.ts](../../lib/universities.ts) | 読み取り境界の実装 |
| [lib/README.md](../../lib/README.md) | lib/ 全体ルール。大学DB セクションは本書への入口 |
| [data/universities.ts](../../data/universities.ts) | 旧 matching 用データ（学部単位・約 25 件） |
| [data/universityEntries.ts](../../data/universityEntries.ts) | 新 CSV 由来データ（入試方式単位・約 532 件） |
| [data/universityMaster.ts](../../data/universityMaster.ts) | 大学マスタ（学校単位・24 件） |
| [data/selectionSteps.ts](../../data/selectionSteps.ts) | 選考ステップ詳細（選考フロー単位・約 466 件） |
| [data/updateLogs.ts](../../data/updateLogs.ts) | DB 更新ログ（メタ情報・初期空配列） |
| [docs/principles/architecture_rules.md](./architecture_rules.md) | アーキテクチャ全般ルール |
| [docs/principles/ai_policy.md](./ai_policy.md) | AI 利用全般ポリシー |
| [docs/matching/](../matching/) | matching 機能のドキュメント |
