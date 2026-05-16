# selfPr context builder（未実装・skeleton）

自己PR 添削向けの context builder の future home。**現時点では実装ファイルなし**。

## 現状の代替経路

- `lib/buildSelfPRDraftSeed.ts` が `StudentProfile` + `analyzeState.summary` から PR たたき台 string を生成している
- `lib/getStudentProfileForFeature.ts` が `studentProfile` → `wallHittingResult` fallback で profile を提供
- `app/api/{essay-chat,reason}/route.ts` 等が「人格コンテキスト」を adhoc 組み立て

## 将来の責務（migrate 後）

- StudentProfile から **自己PR 文脈** に最適化された中間 context を返す
- 含めるもの:
  - `strengths` 上位 3 件（PR の主張の柱）
  - `signatureEpisodes` 上位 1〜2 件（具体例）
  - `appealPoints`（analyzeState.summary 経由 / または StudentProfile に取り込まれた場合は直）
  - `futureConnections` 上位 1 件（締めの将来像）
- 含めないもの:
  - `weaknesses`（PR で混乱の元になる）
  - `questions` / `answers`（壁打ち working memory）

## migrate trigger

- 「自己PR 系 prompt が 2 箇所以上で人格コンテキストを必要とした」時
- もしくは `buildSelfPRDraftSeed` が文字列生成と context 抽出の責務を持ちすぎて Red 判定された時
- それまでは `buildSelfPRDraftSeed` を維持。新規 prompt はまず本ディレクトリに builder を追加する形で寄せる
