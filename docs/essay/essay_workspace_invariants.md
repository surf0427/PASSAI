# EssayWorkspace 不変条件

> **役割**: STEP A で導入した `EssayWorkspace` の不変条件と維持責任を成文化する。
> 違反が観測されたら、まずどこで invariant が崩れたかを特定するための参照点。

関連:
- 型: [`types/essay.ts`](../../types/essay.ts)
- storage: [`lib/essayWorkspaceStorage.ts`](../../lib/essayWorkspaceStorage.ts)
- mutation: [`lib/essay/workspaceOps.ts`](../../lib/essay/workspaceOps.ts)
- 設計思想: [`docs/principles/ai_policy.md`](../principles/ai_policy.md), [`docs/principles/architecture_rules.md`](../principles/architecture_rules.md)

---

## 不変条件一覧

| ID | 不変条件 | 維持責任者 |
|---|---|---|
| **I1** | `reviews` は append-only。`push` のみ。`pop` / `splice` / `sort` 禁止 | `workspaceOps` の全関数 |
| **I2** | `reviews[i].essayBodySnapshot` は review i が生成された時点の本文と完全一致 | `appendInitialReview` (引数 body)、`submitRewriteReview` (rewriteDraft) |
| **I3** | `reviews.length > 0` のとき `workspace.body === reviews.at(-1).essayBodySnapshot` | `appendInitialReview` で同じ `body` を両方に書き込む。`submitRewriteReview` も `body = rewriteDraft` と `reviews.push({essayBodySnapshot: rewriteDraft})` を同時実行 |
| **I4** | `improvementInProgress.sourceReviewIndex` は `reviews` の有効 index（0 <= idx < reviews.length） | `normalizeImprovementInProgress` で範囲外は `improvementInProgress = null` に倒す。`startImprovement` （STEP E）で guard |
| **I5** | `improvementInProgress.answers.length === deepQuestions.length` | `normalize` で短い側に揃える。`updateImprovementAnswers`（STEP E）で常に pair 保持 |
| **I6** | `improvementInProgress` は workspace 単位で**単数**（並行不可） | 型 `\| null` で静的保証。`startImprovement` は既存値を上書き |
| **I7** | `reviews.length <= MAX_REVIEWS_PER_WORKSPACE`（= 20） | `appendInitialReview` で `slice(-20)`、`normalize` で同じ処理 |
| **I8** | `essayWorkspaces` の `id` は unique、配列長 <= `MAX_ESSAY_WORKSPACES`（= 10） | `upsertEssayWorkspace` が同 id を merge して `applyLruCap` |
| **I9** | migration は idempotent（実行後に再度 migrate しても結果不変） | `loadEssayWorkspaces` は localStorage の **キー存在**（`null` か否か）で判定。空配列 `[]` は migration 経路に入らない |
| **I10** | `sparring !== null` のとき `sparring.answers.length === sparring.questions.length` | `startSparring` で `new Array(questions.length).fill('')` 初期化、`updateSparringAnswers` で短い側に揃え、`normalize` で復元時にも整合 |

---

## I3 の特例（legacy migration 経由）

legacy `essayPracticeReview` から migration されたユーザーで、
legacy 側に `essayBodySnapshot` が**存在しなかった**ケース（古いユーザー）:

- `workspace.body = ''`
- `reviews[0].essayBodySnapshot = ''`

両方とも空文字なので I3 は形式的に成立する（`'' === ''`）。
ただし表示上は「本文不明」になる。`/essay/result/[id]` は空文字を許容して描画する。

これは Phase 1 では許容する。完全互換のための代償。

---

## migration idempotency の判定基準

`loadEssayWorkspaces()` 内で:

| localStorage の状態 | migration の挙動 |
|---|---|
| `essayWorkspaces` キーが**存在しない**（`null`） | legacy を読みに行く |
| `essayWorkspaces = '[]'`（空配列） | **migration しない**。「明示的に空状態」として扱う |
| `essayWorkspaces` に entry あり | migration しない |
| 壊れた JSON | parse 失敗で空配列扱い、migration しない |

空配列を「migration 対象」にしないのは、ユーザーが意図的に全 workspace を削除した場合に、
次回起動時に「消したはずの legacy データが復活」する事故を防ぐため。

---

## throw しない原則

storage の load / normalize は throw しない。

- 壊れた entry は `null` を返して呼び出し側で除外する
- 壊れた配列要素は `filter` で落とす
- key 不在 / parse 失敗は空配列を返す

理由: 1 件の壊れたデータで `/essay-practice` 全体が落ちる事故を防ぐ。
壊れたデータの観測はログ（必要ならコンソール）に任せる。

---

## 観測方法（違反検知）

| invariant | 検知方法 |
|---|---|
| I1 | コードレビューで `workspaceOps.ts` 内に `pop` / `splice` / `sort` がないか grep |
| I2 / I3 | 手動 QA で「再添削後に reviews.at(-1).essayBodySnapshot と body が一致」を DevTools で確認 |
| I4 / I5 | normalize が落とすので localStorage 上は常に整合。DevTools で確認可 |
| I6 | 型で静的保証。代入箇所をコードレビュー |
| I7 | DevTools で `JSON.parse(localStorage.essayWorkspaces).reduce(...)` |
| I8 | 同上で配列長確認 |
| I9 | 手動 QA「migration を 1 回実行 → reload → essayWorkspaces 不変」 |

---

## STEP 別の維持責任

| STEP | invariant への影響 | 担保関数 |
|---|---|---|
| A | I1〜I9 の土台 | normalize / appendInitialReview / upsertEssayWorkspace |
| B | dual-write 導入。I1〜I9 は変化なし | （storage 関数追加） |
| E | I4 / I5 / I6 が改善ワーク経由で使われる | startImprovement / abandonImprovement / updateImprovementAnswers |
| F | I5 は変化なし。summary の存在で I に追加項目検討 | attachImprovementSummary |
| G | **I2 / I3 を集中管理**。submitRewriteReview が rewriteDraft → reviews.push / body 更新 / improvementInProgress = null を atomic 実行。guard 違反は throw（rewriteDraft null / improvementInProgress null での呼び出し）| submitRewriteReview / updateRewriteDraft |
| H | view only。reviews.at(-2) / at(-1) を読むのみで invariant に影響しない | （なし） |
| I | polish のみ。invariant 変化なし。**`essayPracticeReview` への dual-write と legacy key は維持**（rollback safety 優先）| storage 層は不変 |
| J (Phase 2) | sparring field 追加、I10（length pair）を導入。reviews / improvementInProgress / body の invariants は変化なし | `startSparring` / `updateSparringAnswers` / `abandonSparring` / `normalizeSparring` |
| K-N (Phase 2) | structure flow page 追加。invariants 変化なし。各 step page は autosave で `updateTarget` / `updateTheme` / `updateMini` / `updateBody` を使う。body 採点時は `appendInitialReview` を通して I2/I3 を再回復 | structure 各 page |
| O (Phase 2) | write flow page 追加（mini / sparring を経由しない target → theme → body）。EssayBodyEditor extract。invariants 変化なし | write 各 page / `EssayBodyEditor` |
| P (Phase 2) | polish / extract のみ。invariants 変化なし。`buildBasicInfoForAi` extract（AI 入力 shape byte-identical を保証） | `lib/essay/buildBasicInfoForAi.ts` |

---

## Phase 1 リリース後の rollback safety（STEP I 確定）

`essayPracticeReview` への legacy 保存と `essayWorkspaces` の正本保存を **dual-write で両方残す**運用を継続する。これにより:

- Phase 1 のいずれかの workspace 経路に bug が見つかったとき、`/essay-practice` を旧 code に戻すだけで legacy のみで運用できる
- migration（STEP A の `migrateFromLegacy`）は idempotent なので、rollback 後の再 forward でも 2 重書き込みは発生しない
- `essayWorkspaces` を localStorage から手動削除しても、`/essay-practice` の次回採点時に新規 workspace が作られて復旧する

判断見直しは Phase 2 完了後とする。
