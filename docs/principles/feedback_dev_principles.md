# 開発方針・コラボ姿勢

総合型選抜向けWebアプリ開発の基本原則（コラボ・ワークフロー寄り）。

## 基本原則

- 基本に忠実
- hooks 最小
- hydration mismatch 回避
- Server/Client 境界を崩さない
- type-safe 重視
- UI/UX 優先
- 小STEPごとの段階実装、Claude Code 暴走防止
- APIコスト意識（Claude API 呼び出しは慎重に）

## Why

一度に大改修するとレビュー困難・回帰リスクが高いため小STEP制を採用。型と境界をきっちり守ることで、Next.js App Router 特有の落とし穴（hydration mismatch、Server Component 誤用）を予防する。

## How to apply

- 実装提案は 1〜2 ファイル単位の STEP 分割で出す
- ユーザーの着手順指示を待ってから書き始める
- 関連方針は [architecture_rules.md](./architecture_rules.md) と [ai_policy.md](./ai_policy.md) を参照
