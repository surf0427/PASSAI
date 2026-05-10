# アーキテクチャルール

コード構造・コンポーネント境界・命名規則など、コードベース固有のルールを集約する。

## 基本方針

- Server/Client 境界を崩さない
- hooks 最小
- hydration mismatch 回避
- type-safe 重視

詳細は [feedback_dev_principles.md](./feedback_dev_principles.md) と [ai_policy.md](./ai_policy.md) を参照。

---

## components の役割

components は配置層によって責務を分ける。

### `app/components/`

- **layout 専用**。
- 現在の住人: `Header.tsx`, `Logo.tsx`。
- 全ページで共通する layout 系コンポーネントを置く。
- 機能 UI（特定機能でしか使わないもの）は置かない。

### `components/ui/`

- **完全に汎用的な最小 UI**（ドメイン文脈を持たない primitive）。
- 例: `Button`, `Card`, `Input`, `Textarea`, `Accordion`, `AlertBox`, `Label`, `LinkButton`。

### `components/shared/`

- **複数機能で使うが、業務文脈を含む UI**。
- 純粋 UI（`components/ui/`）と機能専用 UI（`components/{feature}/`）の中間層。
- **判断基準: 2 機能以上で実利用されていること**。
- 例: `BasicInfoSummary`（input/activity, admission-matching, essay-practice, statement/edit, interview, self-analysis の 6 機能で利用）。

### `components/{feature}/`

- **特定機能専用の UI**（その機能でのみ使われ、複数ファイルに分かれているもの）。
- 既存: `activity/`, `StatementFlow/`, `ScoreDashboard/`, `PassLineComparison/`, `ImprovementGuide/`。
- **新規ディレクトリは camelCase で作る**（例: `interview/`, `essay/`）。
  既存の PascalCase ディレクトリは当面維持（リネームは大規模 import 書き換えになるため後回し）。

### `app/{feature}/components/`

- **そのページ・機能内でのみ使うローカル UI**。まだ他機能で使う予定がないもの。
- 例: `app/analyze/components/`, `app/interview/components/`, `app/interview/{record,history,questions}/components/`。

### `components/` 直下のフラット tsx

- **新規追加は禁止**。
- 既存の statement 専用 flat ファイル（`NgWordCheck.tsx` 等）は statement 機能の安定後に `components/statement/` 配下へ集約予定（後述 TODO）。

### 判断フロー（次のファイルをどこに置くか）

1. layout 専用 → `app/components/`
2. 純粋 UI primitive（ドメイン文脈なし）→ `components/ui/`
3. 2 機能以上で実利用される業務 UI → `components/shared/`
4. 特定機能専用で複数ファイルに分かれる UI → `components/{feature}/`
5. 1 ページ・1 機能でしか使わないローカル UI → `app/{feature}/components/`

---

## storage ルール

### 配置

- すべての `*Storage.ts` は **`lib/` 直下** に置く（flat 命名: `lib/{feature}Storage.ts`）。
- ヘルパー（`safeStorage`）のみ `lib/storage/` 配下。
- 機能ローカル（`app/{feature}/storage/`）には storage ファイルを置かない。Supabase 移行時に grep 漏れを起こすため。

### 形式

- 新規 storage は **JSON 形式を基本とする**（`safeGetStorage` / `safeSetStorage` を経由）。
- raw string 形式は既存の `selfPR_draft` のみ。新規追加禁止。
- 詳細ルールは [`lib/storage/README.md`](../../lib/storage/README.md) を参照。

### アクセス

- localStorage への直書き（`localStorage.setItem` / `getItem` / `removeItem` を直に呼ぶ）は禁止。
- 必ず `lib/{feature}Storage.ts` 経由でアクセスする。
- 既存例外（コメント済みの raw string 直書きなど）以外で `localStorage.*` を呼ばない。

### 一覧

key 名と保存形式の正本は [`lib/storage/README.md`](../../lib/storage/README.md)。
入り口は [`docs/shared/localstorage_keys.md`](../shared/localstorage_keys.md)。

---

## feature 構成ルール

現段階では機能ごとの内部構造を強制統一しない（active 開発中の機能と衝突するため）。

軽い指針のみ:

- **新規機能は feature-local を推奨**（`app/{feature}/components/`, `app/{feature}/utils/` などをその機能配下に置く）。
- ただし **storage は例外**で必ず `lib/` に置く（上記 storage ルール）。
- 横断的に使われると判明した時点で `components/` や `lib/` に昇格する。

参考の流派:

- **interview**: 各サブ機能が `components/` `constants.ts` `types.ts` `utils/` を持つ feature module スタイル
- **analyze**: `components/` のみ
- **statement**: ロジックは `lib/` に集約

統一は active 開発が落ち着いてから（後述 TODO）。

---

## lib の役割

業務ロジック・storage・AI 呼び出し・プロンプト構築・スコアリング・utils を集約する。

- 詳細ルール（配置・命名・禁止事項・新規ファイル追加手順）は [`lib/README.md`](../../lib/README.md) を参照。
- storage key 一覧の正本は [`lib/storage/README.md`](../../lib/storage/README.md)。
- [`docs/shared/localstorage_keys.md`](../shared/localstorage_keys.md) は参照用の入り口。

要点だけ抜粋:

- 現時点では lib 直下 flat 配置を基本とする。例外サブディレクトリは `lib/storage/` と `lib/matching/` のみ。
- 5 ファイル以上の prefix グループができたらサブディレクトリ化を検討（active 開発中の機能は対象外）。
- localStorage 直書き禁止、AI 呼び出しは `lib/ai.ts` 経由、型定義のみのファイルは `types/` に置く。
- API route は HTTP I/O 中心、プロンプト構築・パース・整形は lib へ寄せる。

---

## API Route とサーバーアクションの使い分け

- **現状は API Route のみ採用**（`app/api/{feature}/route.ts`）。
- **Server Actions は未採用**。導入する場合は別途方針を決める（route.ts との責務分担、ユースケース基準）。
- 詳細な責務境界（HTTP I/O は route.ts、prompt 構築・パース・整形は lib へ）は [`lib/README.md`](../../lib/README.md) を参照。

---

## TODO（将来の整理対象）

active 開発と衝突するため今は触らないが、いずれ着手すべき項目。

### コード構造

- **lib 直下の statement family（13 ファイル）→ `lib/statement/` 集約**
  - 対象: `statement*` prefix 8 ファイル + `detectStatementPrepare*` / `evaluateStatementPrepare*` / `getStatementDraftStructureGuide` / `buildStatementPrepareMaterials` 系 5 ファイル。
  - 加えて statement で使う汎用評価ロジック（`admissionEvaluationAxes`, `deepDiveQuestions`, `detectNgWords`, `structureAnalysis`, `passLineComparison`, `scoreRank`, `improvementSuggestions`, `rewriteGuides`, `qualityDeepDive`）も同タイミングでの集約候補。
  - 着手タイミング: statement 機能の active 開発（STEP マーカー消化）が落ち着き、`?? app/statement/...` の untracked ディレクトリが解消された後。
  - note: `lib/statementTypes.ts` は STEP3 で `types/statement.ts` に移動済み。

- **大型 API route の lib 切り出し**
  - 対象: `app/api/interview-feedback/route.ts` (338行), `app/api/essay-review/route.ts` (277行), `app/api/statement-prepare/route.ts` (247行), `app/api/matching/route.ts` (243行)。
  - プロンプト構築・JSON パース・フォーマット変換が route.ts に直書きされている。lib/ への切り出し候補。
  - 着手タイミング: 各機能の active 開発が落ち着いた時点。新規 route は `lib/README.md` の責務境界ルールを守る。

- **`components/` 直下のフラット 7 ファイル → `components/statement/` への集約**
  - 対象: `NgWordCheck.tsx`, `RewriteGuide.tsx`, `StructureCheck.tsx`, `EvaluationAxisCheck.tsx`, `DeepDivePanel.tsx`, `QualityDeepDive.tsx`, `StructureMapping.tsx`。
  - 全て statement 機能専用と確認済み（grep で 1 利用元のみ。`DeepDivePanel` / `QualityDeepDive` / `StructureMapping` は他コンポーネント内部からのみ参照される helper）。
  - 移動を保留する理由: statement の active 開発（prepare / score / improve / compare）と `app/statement/edit/page.tsx` の import 競合。
  - 着手タイミング: statement 機能の現行 STEP が一段落した時点。
  - note: `BasicInfoSummary.tsx` は STEP2 で `components/shared/` へ移動済み。

- **feature-local convention の統一**
  - interview / analyze / statement の 3 流派が混在。落ち着いた段階で標準を決めて寄せる。

### Supabase 移行に向けて

- **legacy normalization の削除条件整理**
  - 対象: `basicInfoStorage`, `statementStorage`, `statementPrepareStorage`, `interviewRecordStorage`, `selfPRDraftStorage` の 5 ファイル。
  - 各ファイルに「導入日 / 削除条件」コメントを足し、Supabase 移行時に「DB migration として再実装する」か「互換打ち切り」かを判断できる状態にする。
  - 今は触らないが、新規に legacy 正規化を追加する際は導入日コメントを必須化する。

- **Supabase migration 戦略の策定**
  - `lib/*Storage.ts` 群を置換対象として、double-write 期間 / cutover 計画を文書化する。
  - raw string キー（`selfPR_draft`）の正規化方針を決める。

- **repository pattern 導入検討**
  - localStorage 同期 / Supabase 非同期の切り替えに備えた抽象化。
  - 導入は Supabase 着手と同 PR で行う。今は不要。
