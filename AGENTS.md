<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Documentation

Project documentation lives under `/docs`.

Read order:
1. `/docs/principles` — 開発方針・AI ポリシー・アーキテクチャルール（最初に必ず読む）
2. `/docs/*/current_state` — 該当機能の現在仕様
3. `/docs/*/score_system` — 機能横断の設計思想（該当機能に限る）
4. `/docs/shared` — localStorage キー一覧、共通 UI コンポーネント
5. `/docs/*/steps` — STEP 開発履歴（直近 STEP に着手するときだけ）

Prefer `/docs` over old memory files. The auto-memory entries under `~/.claude/projects/-Users-yk-paid-app/memory/` may still exist for historical reasons but `/docs` is the canonical source.
