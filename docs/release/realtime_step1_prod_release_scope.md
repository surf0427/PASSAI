# 本番 deploy 公開範囲とリスク（feature/interview-realtime-step1 → main）

> 結論: これは「ターン制AI面接だけ」の deploy ではない。`main`（`19650a1`）は **164 コミット遅れ**で、
> interview-ai も presentation も billing も存在しない。このブランチを本番に出すと
> **現行プロダクトのほぼ全機能が同時に本番公開**される。turn-based だけの分離 deploy は依存上できない。
> merge/push は未実施。本書は意思決定用の整理。

## A. 新たに本番公開されるページ（main に無く HEAD にある page.tsx）

- 認証/課金: `/login`, `/account`, `/pricing`, `/billing/success`, `/billing/cancel`, `/mypage`
- 法務: `/legal/commerce`, `/legal/privacy`, `/legal/terms`
- AI面接: `/interview/ai`（ターン制・**今回の主目的**）, `/interview/ai/realtime`（**flag OFF・導線なし**）
- プレゼン: `/presentation`, `/presentation/setup`, `/presentation/university`, `/presentation/record`, `/presentation/result`, `/presentation/history`
- 小論文: `/essay/write*`, `/essay/structure*`, `/essay/improve*`, `/essay/result*`, `/essay/results`
- 自己分析: `/self-analysis/run`, `/self-analysis/resume`, `/self-analysis/result*`
- 志望理由書: `/statement/analysis/[id]`, `/statement/improve/*`, `/statement/prepare/university`
- Tutor: `/tutor`

## B. 新たに本番公開される API（主なもの）

- 課金: `/api/billing/checkout`, `/api/billing/portal`, `/api/billing/webhook`, `/api/billing/usage/me`
- AI面接: `/api/interview-ai/{session,turn,state,complete,abandon,stt,tts}`、`/api/interview-ai/realtime/{token,turn}`（realtime は flag OFF）
- プレゼン: `/api/presentation/*`（session/attempt/evaluate/qa/transcribe/material/signed-url 等）
- 小論文: `/api/essay-*`、Tutor: `/api/tutor`
- Cron: `/api/cron/reconcile-subscriptions`, `/api/cron/presentation-cleanup`（`vercel.json` のスケジュールで定期実行）

## C. リスクと deploy 前必須アクション

1. **DB 未整備（最重要）**: `main` に無い＝**本番 Supabase に interview_ai/presentation/billing 系テーブル・RLS・index・storage bucket が未適用の可能性大**。
   未適用のまま deploy すると各機能が実行時エラー。→ **`supabase/predeploy_check.sql` を本番で実行**し、
   MISSING/DISABLED/NEEDS-MIGRATION が無いことを確認。不足分の migration を先に適用する。
   - 特に: `interview_ai_sessions_source_check` が `realtime` を含むか（`interview_ai_realtime_source_migration.sql`）、
     presentation の storage bucket（`presentation-recordings` / `presentation-materials`）。
2. **Stripe モード**: `lib/stripe/server.ts` は `sk_live_*` を **runtime で拒否**する設計（test mode 前提）。
   本番で実課金を行うなら、この制約と Price ID / webhook secret（`STRIPE_WEBHOOK_SECRET`）の整合を**必ず事前確認**。
   不整合のまま公開すると課金フローが失敗する。
3. **Cron**: `vercel.json` の cron が本番で定期実行される。`CRON_SECRET` 設定と対象 route の冪等性を確認。
4. **環境変数名**: 正式名は `.env.example` 参照。`REALTIME_ENABLED` / `SOURCE_TYPES_ENABLED` は**誤り（無効）**。
   ターン制音声を出すには `NEXT_PUBLIC_ENABLE_INTERVIEW_SOURCE_TYPES=true` + `INTERVIEW_AI_STT_PROVIDER=openai` + `OPENAI_API_KEY`。
5. **全体UX/LP変更**: `Update UX`×26 等、サイト全体の挙動・LP が同時に変わる。回帰確認は AI面接だけでなく広範に必要。
6. **デバッグ表示**: `/interview/ai` の緑デバッグボックスは本番ホストで非表示化済み（本リリースで対応）。
   realtime token route の diagnostic は realtime OFF のため本番では 403 経路のみ（実害なし・一時的）。

## D. 本番で OFF のまま（今回は公開しない）

- **リアルタイム音声面接**: `REALTIME_INTERVIEW_ENABLED` / `NEXT_PUBLIC_ENABLE_REALTIME_INTERVIEW` を**未設定**。
  - client は「利用できません」カード、token/turn route は 403。`/interview/ai/realtime` への**導線リンクは存在しない**（直URLのみ到達可・到達しても無効）。
  - Realtime のデバッグは Preview（flag ON）で継続。本番では行わない。

## E. 推奨 deploy 順序

1. 本番 Supabase に必要 migration を適用 → `supabase/predeploy_check.sql` で全 OK を確認。
2. 本番 env を `.env.example` の「本番マトリクス」に従って設定（Realtime は未設定＝OFF）。
3. `feature/interview-realtime-step1 → main` を merge（fast-forward 可）→ Vercel が passai.jp へ deploy。
4. 「ターン制AI面接」「Safariマイク復帰」の確認項目を実施。Realtime 導線が出ないことを確認。
5. Realtime は安定後に Preview 検証 → 最後に本番 flag ON。
