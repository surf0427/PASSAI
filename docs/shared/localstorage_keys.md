# localStorage キー一覧

将来 Supabase に移行する想定で、現在 localStorage に保存しているキーを横断的に集約管理する。

## 正本

**キー一覧の正本は [`lib/storage/README.md`](../../lib/storage/README.md) に置く。**

- 全キーの一覧表（key 名 / ファイル / 形式 / 用途）
- `safeStorage` ヘルパーの使い方
- raw string キーの扱い（`selfPR_draft`）
- sessionStorage の扱い
- 新しい storage を追加するときのルール

このファイル（`docs/shared/localstorage_keys.md`）は **`lib/storage/README.md` への入り口** として機能する。仕様の二重化を避けるため、ここに表は書かない。

## storage 配置ルール

- すべての `*Storage.ts` は `lib/` 直下に配置する（flat な命名規則）。
- 機能ローカル（`app/{feature}/storage/`）には storage ファイルを置かない。Supabase 移行時に「localStorage 操作箇所」を grep する際の漏れを防ぐため。
- 新規 storage は JSON 形式を基本とする。raw string 形式は既存の `selfPR_draft` のみ。

## Supabase 移行時の注意

- `lib/*Storage.ts` 群が置換対象になる。grep 対象は `lib/storage/safeStorage.ts` を import している全ファイル。
- 一部の storage ファイルにレガシースキーマの正規化ロジックが入っている（例: [`lib/statementStorage.ts`](../../lib/statementStorage.ts), [`lib/basicInfoStorage.ts`](../../lib/basicInfoStorage.ts)）。Supabase 移行時に「DB 側 migration として再実装するか / レガシー互換を打ち切るか」を判断する必要がある。
- raw string 形式の `selfPR_draft` は JSON 列に入れる前に正規化が必要。
- 詳細な移行戦略は別途 TODO（`docs/principles/architecture_rules.md` を参照）。
