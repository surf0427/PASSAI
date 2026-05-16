# statement context builder（実装あり・現状は flat 配置）

志望理由書添削向けの context builder の future home。**現時点では実体は flat 配置**:
[`../statementContext.ts`](../statementContext.ts) → `buildStatementStudentProfileContext()`

## 現状

- `buildStatementStudentProfileContext(profile: StudentProfile | null): string` が稼働中
- 含めているもの: summary / strengths（上位3） / weaknesses（上位2） / valueKeywords（上位6）
- format: legacy WallHittingContext と揃えるため inline bullets

## 将来の責務（migrate 後）

- 既存の人格 context に加えて、statement 固有の素材を一元化:
  - university context（受験大学・学部・受験方式）
  - admission policy 整形（出典は `lib/buildSelfAnalysisUniversityContext.ts` 系）
  - motivation alignment（志望動機セクションとの整合性チェック用素材）
- 形式: feature builder ごとに合った形（必ずしも string 一択ではない）

## migrate trigger

- 既存 flat `statementContext.ts` 以外に statement-family の context builder が 2 つ目追加された時
- もしくは `incremental_refactor_policy.md §T5`（`contextBuilders/universityDb/` 集約）の trigger と同じ PR で抱き合わせ可能になった時
- それまでは flat ファイルを維持。import 書き換えコストを発生させない
