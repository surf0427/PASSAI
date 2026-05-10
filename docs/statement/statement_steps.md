# /statement STEP 開発履歴

> **役割**: 何を、いつ、なぜ追加したかを時系列で残す。現在の仕様は [statement_current_state.md](./statement_current_state.md) に分離。

## 完了済み STEP（時系列・粒度は粗い）

実装済み機能（STEP 番号未振り）：

- 整理フロー（入力 → Claude API 整理メモ生成 → 表示 → 下書きへ）
- `weakPoints`（浅さ検知）
- `logicGaps`（論理抜け検知）
- `qualityEvaluation`（◎ ○ △ の整理品質評価）
- `followUpQuestions`（固定深掘り質問）
- `followUpAnswers`（深掘り回答入力 + localStorage 保存）
- 再整理（`followUpAnswers` を使って再整理）
- `FacultyCategory`（学部系統）
- 学部系統別チェックポイント
- 下書き構成ガイド
- 自己分析・活動整理との接続（候補カード、「この内容を参考にする」）
- /statement 表示（整理メモ表示、追加メモ表示、表示 ON/OFF 切替、2 カラム UI、追加メモ削除）

## 直近の STEP

### STEP 33: score 正本統一（完了）

- 課題：`/statement/score` / `/statement/compare` / `/statement/improve` がそれぞれハードコードの評価値（合計 66）を表示しており、`/statement/edit` で取得した実スコアと一致しなかった。
- 対応：
  - `lib/statementScoreSource.ts` を新設し「保存済み正規化スコアの読み出し口」を 1 箇所に集約（`getLatestStatementScore` / `breakdownToPassLineItems` / `breakdownToRankItems`）。
  - 上記 3 ページを Client Component 化し、ハードコード評価値を撤去。`getLatestStatementScore()` 経由で `statementReviewHistory` から読み出して表示する形に統一。
  - 添削履歴が空の場合は「添削履歴がまだありません」誘導カードを表示。
  - 保存前 normalize は既に `app/statement/edit/page.tsx` の `mapApiResponse` で実行済み。
- 詳細：[statement_score_system.md](./statement_score_system.md)

### STEP 34: /statement 最初の画面に「機能の使い方ガイド」追加（完了）

- 課題：機能が増えて初見ユーザーが何から始めればいいか分からない
- 対応：[`app/statement/page.tsx`](../../app/statement/page.tsx) のエントリ画面、選択肢 2 カードの直前に静的ガイドカードを追加。Server Component のまま（動的データなし、localStorage / score 未参照）。
- 内容：
  - 見出し「この機能の使い方」
  - 説明文（「まだ書けていなくても大丈夫」「AI が構成・具体性・大学との一致度をチェック」）
  - 4 ステップの番号付きリスト（短くてもいい → AI 添削 → 追加再添削 → 保存）
  - 注意書き：「AI が代わりに完成させる機能ではない、自分で書いた文章を改善するためのサポート」（AI ポリシー [ai_policy.md](../principles/ai_policy.md) の明示）
- スタイル：`bg-blue-50 border-blue-100` の Card で目立ちすぎず初見で目に入る配置。レスポンシブ余白で SP 圧迫感なし。

### STEP 35: 使い方ガイドを「伴走型ツール」が伝わる構成に改訂（完了）

- 課題：STEP 34 の文言は「AI 添削」が前面に出過ぎており、「書けない人でも始められる」「合格ラインとの差分→改善まで導く」という本来の強みが伝わっていなかった。
- 対応：[`app/statement/page.tsx`](../../app/statement/page.tsx) のヘッダー副文 + ガイドカードの中身を改訂。Server Component 維持、localStorage / score 未触。
- ヘッダー副文：「下書きの有無に合わせて、進め方を選んでください。」 → 「何から書けばいいかわからなくても大丈夫です。AI があなたの経験・興味・将来像を整理しながら、志望理由書を完成までサポートします。」
- ガイドカード：
  - タイトル「この機能の使い方」 → 「この機能でできること」
  - 説明文：「書けない人でも、AI のヒントで書き始められる。書いた後は完成度・一致度・合格ライン差分を確認しながら改善できる」
  - **5 STEP 構成**（タイトル + 本文）：
    1. まずは書ける範囲で OK
    2. 書けない場合は AI がヒントを出す
    3. AI 添削で現在地を確認
    4. 改善ポイントを確認
    5. 修正して再添削
  - 各 STEP は `STEP N` ラベル + 太字タイトル + 本文の 3 段組み（番号バッジは廃止）
  - 注意書きは AI ポリシーの再掲を維持
- スタイル：`space-y-5 sm:space-y-6` で行間広め、`leading-relaxed` で読みやすく、SP 圧迫感を抑制。既存の `text-[11px] tracking-widest` ラベルパターン（`/statement/edit` の「次のステップ」と同じ）を STEP ラベルに流用。

## 次にやる予定

未定。

## STEP の書き方ルール

- 新しい STEP を追加するときはこのファイル末尾に追記する
- 追加した結果が現在仕様に組み込まれたら [statement_current_state.md](./statement_current_state.md) も更新する
