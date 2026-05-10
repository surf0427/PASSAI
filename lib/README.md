# lib ディレクトリのルール

業務ロジック・storage・AI 呼び出し・プロンプト・スコアリングを集約する場所。新規ファイルを追加する前に必ず本ドキュメントを参照する。

---

## lib ディレクトリの役割

lib 配下に置くもの:

- **業務ロジック** — UI からは独立した、ドメインのルール・計算・整形（純関数中心）
- **storage** — localStorage への永続化ヘルパー（`{feature}Storage.ts`）
- **AI 呼び出し** — Claude API（Anthropic SDK）を使う処理
- **プロンプト構築** — AI に渡す文字列の組み立て
- **scoring / evaluation** — ルールベースの評価ロジック（AI 不使用）
- **utils** — 上記カテゴリに収まらない小さな共通関数

lib に置かないもの:

- React コンポーネント → `components/` または `app/{feature}/components/`
- ページ専用フック → `hooks/`（横断利用）または `app/{feature}/` 内
- 型定義のみのファイル → `types/`

---

## 配置ルール

### 現状の方針

**現時点では lib 直下 flat 配置を基本とする**。

例外サブディレクトリは 2 つのみ:

| サブディレクトリ | 用途 | 中身 |
|---|---|---|
| `lib/storage/` | `safeStorage.ts` ヘルパーと storage 関連 README 用 | `safeStorage.ts`, `README.md` |
| `lib/matching/` | マッチング機能の deterministic scoring 層 | `calculateScore.ts`, `suggestUniversities.ts`, `deriveStudentAnalysis.ts`, `buildUniversityContextsFromBasicInfo.ts`, `generateReason.ts` |

### サブディレクトリ化の判断基準

**5 ファイル以上の prefix グループができたらサブディレクトリ化を検討する**。

ただし以下の制約に従う:

- 対応する機能が active 開発中の間は**移動しない**（PR コンフリクト回避）。
- 移動は機能の STEP マーカーが消化され、関連する `?? app/{feature}/...` の untracked ディレクトリが解消されたタイミングで実施する。

現在の集約候補（実施は機能安定後）:

- **`lib/statement/`** — `statementXxx.ts`（8 ファイル）+ `detectStatementXxx.ts` / `evaluateStatementXxx.ts` / `getStatementXxx.ts` / `buildStatementXxx.ts` 系（5 ファイル）

---

## 命名ルール

新規ファイルは以下のテンプレートに従う。既存の命名揺れは触らない（リネームは大規模 import 書き換えのため）。

| カテゴリ | 命名 | 例 |
|---|---|---|
| storage（永続化） | `{feature}Storage.ts` | `basicInfoStorage.ts`, `interviewRecordStorage.ts` |
| storage 派生（draft / sub） | `{feature}{Sub}Storage.ts` | `interviewDraftStorage.ts`, `selfPRDraftStorage.ts` |
| daily limit | `{feature}Limit.ts`（`createDailyLimit` を使う） | `statementLimit.ts`, `statementPrepareLimit.ts` |
| サーバー rate limit | `serverRateLimit.ts`（既存 1 つのみ） | — |
| AI クライアント | `ai.ts`（既存 1 つのみ） | — |
| プロンプト共通（自己分析系） | `prompts.ts`（既存） | — |
| プロンプト機能別 | `{feature}Prompt.ts` | `statementPrompt.ts` |
| プロンプト部品 | `build{Section}.ts` | `buildBasicInfoPromptSection.ts`, `buildUniversityContext.ts` |
| 検出（ルールベース） | `detect{Concept}.ts` | `detectNgWords.ts`, `detectStatementPrepareWeakPoints.ts` |
| 評価（ルールベース） | `evaluate{Concept}.ts` | `evaluateStatementPrepareQuality.ts` |
| 型定義のみ | **types/ に置く**。`lib/*Types.ts` は禁止 | `types/interview.ts`, `types/statement.ts` |

---

## 禁止ルール

1. **localStorage の直書き禁止**
   - `localStorage.setItem` / `getItem` / `removeItem` を直に呼ばない。
   - 必ず `safeGetStorage` / `safeSetStorage` / `safeRemoveStorage`（`lib/storage/safeStorage.ts`）経由でアクセスする。
   - 既存例外（raw string 形式の `selfPR_draft`）は維持。新規追加禁止。

2. **storage / limit / display logic を新規ファイルで混ぜない**
   - 既存の `interviewAdditionalUsage.ts` は混合になっているが、これに倣わない。
   - 新規追加時は別ファイルに分割する。

3. **AI 呼び出しは `lib/ai.ts` 経由**
   - Anthropic SDK を直接 import するファイルは `lib/ai.ts` 1 つのみとする。
   - これにより「AI 利用箇所 = `lib/ai.ts` を import している場所」を grep 一発で列挙できる。コスト管理と監査のため。

4. **型定義だけのファイルを lib に置かない**
   - 型と関数が混在するファイル（例: `scoreRank.ts` の `Rank` 型）は lib 維持で OK。
   - 純粋に型のみのファイルは `types/` へ。

5. **active 開発中の大規模移動は禁止**
   - statement / matching など STEP マーカーが入っている機能群は触らない。
   - 移動は機能安定後の整理 STEP で実施。

---

## API route との責務境界

`app/api/{feature}/route.ts` は **HTTP I/O 中心**:

- リクエスト bodyの検証
- レスポンスの整形
- rate limit / エラーハンドリング

以下は `lib/` へ寄せる:

- プロンプト構築
- JSON パース
- フォーマット変換（例: AI レスポンス → UI 表示用テキスト）
- スコアリング / 評価ロジック

### 既存例外

以下の大型 route には責務混在が残っている。**active 開発が落ち着くまで触らない**:

| route | 行数 | 主な混在内容 |
|---|---|---|
| `app/api/interview-feedback/route.ts` | 338 | level → number 変換、improvementSummary フォーマット |
| `app/api/essay-review/route.ts` | 277 | 受験方式別ガイダンス分岐 |
| `app/api/statement-prepare/route.ts` | 247 | rate limit 設定値、JSON 抽出 |
| `app/api/matching/route.ts` | 243 | プロンプト構築、universityContext 整形 |

新規 route を追加する際は本ルールを守る。

---

## Supabase 移行時の置換対象

`lib/storage/safeStorage.ts` を import している全ファイルが置換対象になる。

grep で列挙:

```sh
grep -l "from '@/lib/storage/safeStorage'" lib/*.ts
```

key 一覧と保存形式の正本は [`lib/storage/README.md`](./storage/README.md)。`docs/shared/localstorage_keys.md` は参照用の入り口。

### 移行時の追加注意

1. **legacy normalization の翻訳**
   - 以下のファイルにスキーマ正規化ロジックが入っている。Supabase の DB migration として再実装するか、互換打ち切りの判断を要する:
     - `basicInfoStorage.ts`
     - `statementStorage.ts`
     - `statementPrepareStorage.ts`
     - `interviewRecordStorage.ts`
     - `selfPRDraftStorage.ts`

2. **raw string キー**
   - `selfPR_draft` は raw string 形式。JSON 列に入れる前に正規化が必要。

3. **同期 → 非同期 API の変換**
   - localStorage 同期、Supabase 非同期。`load*` / `save*` 関数のシグネチャが `Promise` 返却に変わる。呼び出し側全箇所で `await` の追加が必要になる。Supabase 導入と同 PR で一括変換する想定。

---

## 大学DB（`lib/universities.ts`）

`data/universities.ts` / `data/universityEntries.ts` の**唯一の読み取り境界**。`page` / `route` / 他 `lib` から `data/` 配下を直接 import せず、必ず `lib/universities.ts` 経由で読む。Supabase 移行時はこのファイルの中身だけを差し替える。

### 利用ルールの正本

機能別の DB 利用方針 / AI プロンプト原則 / 例外対応 / 将来 helper の予約は **[`docs/principles/university_database_usage_guide.md`](../docs/principles/university_database_usage_guide.md) が正本**。本セクションには重複させない。

### lib/ 観点で押さえるべき要点

- 現状エクスポートは `getAllUniversities(): University[]` のみ。matching が唯一の消費者
- `data/` 配下に大学データは 5 ファイル併存:
  - [`data/universities.ts`](../data/universities.ts) — 旧 matching 用（学部単位・約 25 件、`types/matching.ts:University`）
  - [`data/universityEntries.ts`](../data/universityEntries.ts) — CSV 由来の新DB（入試方式単位・約 532 件、`UniversityEntry` 型・現状 import ゼロ）
  - [`data/universityMaster.ts`](../data/universityMaster.ts) — 大学マスタ（学校単位・24 件、`UniversityMaster` 型・現状 import ゼロ）。`universityEntries` と `school_id` で結合する想定
  - [`data/selectionSteps.ts`](../data/selectionSteps.ts) — 選考ステップ詳細（選考フロー単位・466 件、`SelectionStep` 型・現状 import ゼロ）。`universityEntries` と `entry_id` で結合する想定
  - [`data/updateLogs.ts`](../data/updateLogs.ts) — 更新ログ（メタ情報・初期は空配列、`UpdateLog` 型・現状 import ゼロ）。`target_type` + `target_id` で任意レイヤーへの soft FK
- Supabase 移行時は `lib/universities.ts` の中身のみを差し替える。同期 → 非同期化が必要になった場合は呼び出し側 `await` 化を別 STEP として独立させる
- 新規 helper / 型切り出し / context builder は禁止。消費者が現れた PR で初めて追加する
